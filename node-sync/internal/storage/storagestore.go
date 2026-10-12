package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
)

// StorageStore guarda los Home a través de Distributed Storage (node-repository),
// con el token del propio usuario.
//
// Por qué así (pendiente crítico 2 de CLAUDE.md): el contrato de FileSync
// delega "en Storage toda la persistencia real". Escribiendo por la API REST
// lo sincronizado aparece en "Mis archivos", cuenta para la cuota, respeta los
// permisos y cada subida sobre un archivo existente crea una VERSIÓN nueva en
// Storage en lugar de pisarla. node-sync no guarda ningún archivo.
//
// Endpoints usados (todos existentes en node-repository, ninguno nuevo):
//
//	GET    /storage/directorios/{id}          ("root" = Home del usuario)
//	POST   /storage/directorios               {nombre, directorioPadreId}
//	POST   /storage/archivos?directorioDestino=&sobrescribir=true   (multipart "archivo")
//	GET    /storage/archivos/{id}/descargar
//	DELETE /storage/archivos/{id}
type StorageStore struct {
	*registro
	base string // p. ej. http://127.0.0.1:8084/storage
	http *http.Client
}

// NewStorageStore: urlBase es la raíz de la API ("http://host:8084/storage");
// rutaCA, opcional, la CA que firma el HTTPS de node-repository; rutaRegistro
// es el JSON con la versión por usuario y la caché de hashes.
func NewStorageStore(urlBase, rutaCA, rutaRegistro string) (*StorageStore, error) {
	transporte := http.DefaultTransport.(*http.Transport).Clone()
	if rutaCA != "" {
		pem, err := os.ReadFile(rutaCA)
		if err != nil {
			return nil, fmt.Errorf("CA de Storage: %w", err)
		}
		raices := x509.NewCertPool()
		if !raices.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("CA de Storage: %s no contiene certificados PEM", rutaCA)
		}
		transporte.TLSClientConfig = &tls.Config{RootCAs: raices, MinVersion: tls.VersionTLS12}
	}
	return &StorageStore{
		registro: nuevoRegistro(rutaRegistro),
		base:     strings.TrimRight(urlBase, "/"),
		// Sin Timeout global: una subida o descarga grande puede durar
		// minutos. El límite lo pone el contexto de cada RPC.
		http: &http.Client{Transport: transporte},
	}, nil
}

// nodo es la forma pública de un nodo de Storage (ArchivoService.#aDto).
type nodo struct {
	ID          string `json:"id"`
	Nombre      string `json:"nombre"`
	Tipo        string `json:"tipo"` // "archivo" | "directorio"
	TamanoBytes int64  `json:"tamanoBytes"`
	Version     int    `json:"version"`
}

func (n nodo) esDirectorio() bool { return n.Tipo == "directorio" }
func (n nodo) claveHash() string  { return n.ID + "@" + strconv.Itoa(n.Version) }

// --- HTTP ---------------------------------------------------------------------

func (s *StorageStore) pedir(ctx context.Context, ses Sesion, metodo, ruta string, cuerpo io.Reader, tipo string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, metodo, s.base+ruta, cuerpo)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+ses.Token)
	if tipo != "" {
		req.Header.Set("Content-Type", tipo)
	}
	resp, err := s.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w: %v", ErrNoDisponible, err)
	}
	if resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, errorDeStorage(resp)
	}
	return resp, nil
}

// errorDeStorage traduce la respuesta de error de Storage
// ({error, mensaje}, middleware/manejoErrores.js) a un error de esta capa.
func errorDeStorage(resp *http.Response) error {
	var cuerpo struct {
		Error   string `json:"error"`
		Mensaje string `json:"mensaje"`
	}
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	_ = json.Unmarshal(b, &cuerpo)
	detalle := cuerpo.Mensaje
	if detalle == "" {
		detalle = strings.TrimSpace(string(b))
	}
	switch resp.StatusCode {
	case http.StatusUnauthorized:
		return ErrNoAutorizado
	case http.StatusForbidden:
		return fmt.Errorf("%w: %s", ErrPermiso, detalle)
	case http.StatusNotFound:
		return ErrNotFound
	case http.StatusRequestEntityTooLarge:
		return fmt.Errorf("%w: %s", ErrCuota, detalle)
	case http.StatusBadRequest:
		return fmt.Errorf("%w: %s", ErrBadPath, detalle)
	case http.StatusServiceUnavailable, http.StatusBadGateway, http.StatusGatewayTimeout:
		return fmt.Errorf("%w: %s", ErrNoDisponible, detalle)
	}
	return fmt.Errorf("Storage respondio %d: %s", resp.StatusCode, detalle)
}

func (s *StorageStore) listar(ctx context.Context, ses Sesion, dirID string) ([]nodo, error) {
	resp, err := s.pedir(ctx, ses, http.MethodGet, "/directorios/"+url.PathEscape(dirID), nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var hijos []nodo
	if err := json.NewDecoder(resp.Body).Decode(&hijos); err != nil {
		return nil, fmt.Errorf("respuesta de Storage ilegible: %w", err)
	}
	return hijos, nil
}

func (s *StorageStore) crearDirectorio(ctx context.Context, ses Sesion, nombre, padreID string) (nodo, error) {
	cuerpo, _ := json.Marshal(map[string]string{"nombre": nombre, "directorioPadreId": padreID})
	resp, err := s.pedir(ctx, ses, http.MethodPost, "/directorios", bytes.NewReader(cuerpo), "application/json")
	if err != nil {
		return nodo{}, err
	}
	defer resp.Body.Close()
	var n nodo
	return n, json.NewDecoder(resp.Body).Decode(&n)
}

// --- Rutas <-> ids de Storage ----------------------------------------------------

func partes(rel string) []string {
	if rel == "" {
		return nil
	}
	return strings.Split(rel, "/")
}

// resolverDirectorio recorre la ruta desde el Home y devuelve el id del último
// directorio. Con crear=true crea los que falten (como "mkdir -p").
func (s *StorageStore) resolverDirectorio(ctx context.Context, ses Sesion, rel string, crear bool) (string, error) {
	id := "root"
	for _, nombre := range partes(rel) {
		hijos, err := s.listar(ctx, ses, id)
		if err != nil {
			return "", err
		}
		siguiente := ""
		for _, h := range hijos {
			if h.Nombre == nombre {
				if !h.esDirectorio() {
					return "", fmt.Errorf("%w: %q es un archivo, no una carpeta", ErrBadPath, nombre)
				}
				siguiente = h.ID
				break
			}
		}
		if siguiente == "" {
			if !crear {
				return "", ErrNotFound
			}
			n, err := s.crearDirectorio(ctx, ses, nombre, id)
			if err != nil {
				return "", err
			}
			siguiente = n.ID
		}
		id = siguiente
	}
	return id, nil
}

func (s *StorageStore) buscarArchivo(ctx context.Context, ses Sesion, rel string) (nodo, error) {
	dir, nombre := path.Split(rel)
	dirID, err := s.resolverDirectorio(ctx, ses, strings.TrimSuffix(dir, "/"), false)
	if err != nil {
		return nodo{}, err
	}
	hijos, err := s.listar(ctx, ses, dirID)
	if err != nil {
		return nodo{}, err
	}
	for _, h := range hijos {
		if h.Nombre == nombre && !h.esDirectorio() {
			return h, nil
		}
	}
	return nodo{}, ErrNotFound
}

// recorrer visita todos los archivos bajo dirID; prefijo es su ruta relativa.
func (s *StorageStore) recorrer(ctx context.Context, ses Sesion, dirID, prefijo string, visitar func(rel string, n nodo) error) error {
	hijos, err := s.listar(ctx, ses, dirID)
	if err != nil {
		return err
	}
	for _, h := range hijos {
		rel := h.Nombre
		if prefijo != "" {
			rel = prefijo + "/" + h.Nombre
		}
		if h.esDirectorio() {
			if err := s.recorrer(ctx, ses, h.ID, rel, visitar); err != nil {
				return err
			}
			continue
		}
		if err := visitar(rel, h); err != nil {
			return err
		}
	}
	return nil
}

// --- Store -----------------------------------------------------------------------

func (s *StorageStore) List(ctx context.Context, ses Sesion, carpeta string) ([]FileInfo, error) {
	dirID, err := s.resolverDirectorio(ctx, ses, carpeta, false)
	if err == ErrNotFound {
		return nil, nil // la carpeta aún no existe: primera sincronización
	}
	if err != nil {
		return nil, err
	}
	var out []FileInfo
	err = s.recorrer(ctx, ses, dirID, carpeta, func(rel string, n nodo) error {
		h, ok := s.hash(n.claveHash())
		if !ok {
			// Versión que node-sync no ha visto (subida desde el portal, el
			// móvil por REST, etc.): se descarga una vez para calcular su hash.
			if h, err = s.calcularHash(ctx, ses, n.ID); err != nil {
				return fmt.Errorf("hash de %s: %w", rel, err)
			}
			s.fijarHash(n.claveHash(), h)
		}
		out = append(out, FileInfo{Rel: rel, Hash: h, Size: n.TamanoBytes})
		return nil
	})
	return out, err
}

func (s *StorageStore) descargar(ctx context.Context, ses Sesion, id string) (io.ReadCloser, error) {
	resp, err := s.pedir(ctx, ses, http.MethodGet, "/archivos/"+url.PathEscape(id)+"/descargar", nil, "")
	if err != nil {
		return nil, err
	}
	return resp.Body, nil
}

func (s *StorageStore) calcularHash(ctx context.Context, ses Sesion, id string) (string, error) {
	rc, err := s.descargar(ctx, ses, id)
	if err != nil {
		return "", err
	}
	defer rc.Close()
	h := sha256.New()
	if _, err := io.Copy(h, rc); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (s *StorageStore) OpenRead(ctx context.Context, ses Sesion, rel string) (io.ReadCloser, error) {
	n, err := s.buscarArchivo(ctx, ses, rel)
	if err != nil {
		return nil, err
	}
	return s.descargar(ctx, ses, n.ID)
}

// Save sube el archivo con sobrescribir=true: si ya existe, Storage crea una
// versión nueva (no se pierde la anterior). El cuerpo multipart se genera a
// medida que llegan los fragmentos gRPC, sin cargar el archivo en memoria aquí.
func (s *StorageStore) Save(ctx context.Context, ses Sesion, rel string, r io.Reader) (int64, error) {
	dir, nombre := path.Split(rel)
	if nombre == "" {
		return 0, ErrBadPath
	}
	dirID, err := s.resolverDirectorio(ctx, ses, strings.TrimSuffix(dir, "/"), true)
	if err != nil {
		return 0, err
	}

	lector, escritor := io.Pipe()
	mp := multipart.NewWriter(escritor)
	h := sha256.New()
	var n int64
	go func() {
		parte, err := mp.CreateFormFile("archivo", nombre)
		if err == nil {
			n, err = io.Copy(parte, io.TeeReader(r, h))
		}
		if err == nil {
			err = mp.Close()
		}
		escritor.CloseWithError(err)
	}()

	q := url.Values{"directorioDestino": {dirID}, "sobrescribir": {"true"}}
	resp, err := s.pedir(ctx, ses, http.MethodPost, "/archivos?"+q.Encode(), lector, mp.FormDataContentType())
	_ = lector.CloseWithError(io.ErrClosedPipe) // si Storage cortó antes, libera la goroutine
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	var guardado nodo
	if err := json.NewDecoder(resp.Body).Decode(&guardado); err != nil {
		return 0, fmt.Errorf("respuesta de Storage ilegible: %w", err)
	}
	// El hash ya se calculó al subir: la próxima comparación no descarga nada.
	s.fijarHash(guardado.claveHash(), hex.EncodeToString(h.Sum(nil)))
	return n, nil
}

func (s *StorageStore) Delete(ctx context.Context, ses Sesion, rel string) error {
	n, err := s.buscarArchivo(ctx, ses, rel)
	if err != nil {
		return err
	}
	resp, err := s.pedir(ctx, ses, http.MethodDelete, "/archivos/"+url.PathEscape(n.ID), nil, "")
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (s *StorageStore) Count(ctx context.Context, ses Sesion) (int, error) {
	total := 0
	err := s.recorrer(ctx, ses, "root", "", func(string, nodo) error { total++; return nil })
	return total, err
}

// Comprobación de compilación: StorageStore cumple Store.
var _ Store = (*StorageStore)(nil)
