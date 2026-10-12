// Package dominio contiene las reglas puras de la sincronizacion: que hacer con
// cada archivo dado lo que hay en el dispositivo, lo que hay en el servidor y
// lo que habia en la ultima sincronizacion. No conoce gRPC, ni HTTP, ni discos.
package dominio

import (
	"errors"
	"path"
	"sort"
	"strings"
	"time"
)

// Accion es lo que el cliente debe hacer con un archivo.
type Accion int

const (
	Igual          Accion = iota // sin cambios
	Subir                        // cambio local -> al servidor
	Bajar                        // cambio en el servidor -> al dispositivo
	Borrar                       // se borro en el servidor -> borrar la copia local
	Conflicto                    // cambio en ambos lados -> MANTENER_AMBOS
	BorrarServidor               // se borro en el dispositivo -> borrar en el servidor
)

// ArchivoLocal es lo que reporta el dispositivo de un archivo.
type ArchivoLocal struct {
	Ruta      string
	Hash      string // vacio si Eliminado
	HashBase  string // hash en la ultima sincronizacion correcta ("" = nunca)
	Eliminado bool   // estaba en la ultima sincronizacion y ya no existe
}

// ArchivoServidor es un archivo del Home en el servidor.
type ArchivoServidor struct {
	Ruta string
	Hash string
}

// Decision es la accion para un archivo concreto.
type Decision struct {
	Ruta          string
	Accion        Accion
	HashServidor  string
	RutaConflicto string // solo en Conflicto
}

var (
	ErrRutaInvalida = errors.New("ruta invalida")
	ErrChecksum     = errors.New("checksum invalido: se espera SHA-256 en hexadecimal (64 caracteres)")
)

// ValidarChecksum exige SHA-256 en hexadecimal (Contrato_FileSync, SYNC-005).
func ValidarChecksum(h string) error {
	if len(h) != 64 {
		return ErrChecksum
	}
	for _, c := range h {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return ErrChecksum
		}
	}
	return nil
}

// NormalizarRuta deja una ruta relativa al Home en forma canonica ("a/b.txt")
// y rechaza las que intentan salir del Home ("../", absolutas, vacias).
func NormalizarRuta(r string) (string, error) {
	r = strings.ReplaceAll(r, `\`, "/")
	if r == "" || strings.HasPrefix(r, "/") {
		return "", ErrRutaInvalida
	}
	for _, parte := range strings.Split(r, "/") {
		if parte == ".." {
			return "", ErrRutaInvalida
		}
	}
	limpia := path.Clean(r)
	if limpia == "." || limpia == "" {
		return "", ErrRutaInvalida
	}
	return limpia, nil
}

// DentroDe indica si `ruta` esta dentro de `carpeta` (carpeta vacia = todo el Home).
func DentroDe(carpeta, ruta string) bool {
	return carpeta == "" || strings.HasPrefix(ruta, carpeta+"/")
}

// RutaConflicto es el nombre de la copia del dispositivo cuando hay conflicto
// (Contrato_FileSync, ResolverConflicto/MANTENER_AMBOS):
//
//	"informe (conflicto - movil-ana - 2026-10-12 17.05).pdf"
//
// La hora va con punto y no con dos puntos porque Windows no los admite en
// nombres de archivo, y la copia tiene que poder bajar a cualquier escritorio.
func RutaConflicto(ruta, dispositivo string, cuando time.Time) string {
	dir, nombre := path.Split(ruta)
	ext := path.Ext(nombre)
	base := strings.TrimSuffix(nombre, ext)
	if dispositivo == "" {
		dispositivo = "dispositivo"
	}
	dispositivo = strings.NewReplacer("/", "-", `\`, "-", ":", "-").Replace(dispositivo)
	return dir + base + " (conflicto - " + dispositivo + " - " + cuando.Format("2006-01-02 15.04") + ")" + ext
}

// Planificar decide que hacer con cada archivo. Es una sincronizacion de TRES
// VIAS: la base (lo sincronizado la ultima vez) dice quien cambio.
//
//	dispositivo   servidor     base        -> accion
//	-----------   ---------    ---------      -------------------------------
//	H             (no esta)    vacia          Subir      (nuevo local)
//	H             (no esta)    = H            Borrar     (se borro en el servidor)
//	H             (no esta)    != H           Subir      (cambio local gana al borrado)
//	H             H                           Igual
//	H             S            = H            Bajar      (cambio solo en el servidor)
//	H             S            = S            Subir      (cambio solo en el dispositivo)
//	H             S            otra/vacia     Conflicto  (cambio en ambos)
//	eliminado     S            = S            BorrarServidor
//	eliminado     S            != S           Conflicto  (sin copia local: solo se baja)
//	eliminado     (no esta)                   (nada: ya esta borrado en ambos)
//	(no esta)     S                           Bajar      (nuevo en el servidor)
//
// Ante la duda nunca se borra: un cambio siempre gana a un borrado. El
// contrato (casos límite) exige que "borrado local + modificado remoto" sea
// CONFLICTO y no una eliminación; como no queda copia local, resolverlo con
// MANTENER_AMBOS se reduce a bajar la versión del servidor.
func Planificar(locales []ArchivoLocal, servidor []ArchivoServidor, dispositivo string, ahora time.Time) []Decision {
	srv := make(map[string]string, len(servidor))
	for _, f := range servidor {
		srv[f.Ruta] = f.Hash
	}

	var out []Decision
	vistos := make(map[string]bool, len(locales))
	for _, l := range locales {
		vistos[l.Ruta] = true
		s, enServidor := srv[l.Ruta]

		if l.Eliminado {
			switch {
			case !enServidor:
				// Borrado en ambos lados: nada que hacer.
			case s == l.HashBase:
				out = append(out, Decision{Ruta: l.Ruta, Accion: BorrarServidor, HashServidor: s})
			default:
				out = append(out, Decision{
					Ruta: l.Ruta, Accion: Conflicto, HashServidor: s,
					RutaConflicto: RutaConflicto(l.Ruta, dispositivo, ahora),
				})
			}
			continue
		}

		switch {
		case !enServidor && l.HashBase != "" && l.HashBase == l.Hash:
			out = append(out, Decision{Ruta: l.Ruta, Accion: Borrar})
		case !enServidor:
			out = append(out, Decision{Ruta: l.Ruta, Accion: Subir})
		case s == l.Hash:
			out = append(out, Decision{Ruta: l.Ruta, Accion: Igual, HashServidor: s})
		case l.HashBase != "" && l.HashBase == l.Hash:
			out = append(out, Decision{Ruta: l.Ruta, Accion: Bajar, HashServidor: s})
		case l.HashBase != "" && l.HashBase == s:
			out = append(out, Decision{Ruta: l.Ruta, Accion: Subir, HashServidor: s})
		default:
			out = append(out, Decision{
				Ruta: l.Ruta, Accion: Conflicto, HashServidor: s,
				RutaConflicto: RutaConflicto(l.Ruta, dispositivo, ahora),
			})
		}
	}
	for ruta, s := range srv {
		if !vistos[ruta] {
			out = append(out, Decision{Ruta: ruta, Accion: Bajar, HashServidor: s})
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Ruta < out[j].Ruta })
	return out
}
