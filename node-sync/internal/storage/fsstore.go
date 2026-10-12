package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// FSStore implementa Store escribiendo directo en el sistema de archivos
// (<base>/<uid>/...).
//
// ANTES era el único almacén y node-sync escribía así en el montaje NFS
// /srv/home, SALTÁNDOSE a Distributed Storage: lo sincronizado no aparecía en
// "Mis archivos", no contaba para la cuota ni respetaba permisos ni versiones.
// AHORA el almacén por defecto es StorageStore; este queda solo para pruebas
// aisladas sin node-repository (-almacen=fs).
type FSStore struct {
	*registro
	base string
}

func NewFSStore(base string) (*FSStore, error) {
	if err := os.MkdirAll(base, 0o755); err != nil {
		return nil, err
	}
	return &FSStore{registro: nuevoRegistro(filepath.Join(base, ".sync-meta.json")), base: base}, nil
}

// userRoot devuelve (creándola) la carpeta Home del usuario.
func (s *FSStore) userRoot(uid string) (string, error) {
	if uid == "" || uid == "." || uid == ".." || strings.ContainsAny(uid, `/\:`) {
		return "", ErrBadPath
	}
	p := filepath.Join(s.base, uid)
	if err := os.MkdirAll(p, 0o755); err != nil {
		return "", err
	}
	return p, nil
}

// safeJoin evita el "path traversal": la ruta relativa nunca sale del Home.
func safeJoin(base, rel string) (string, error) {
	if rel == "" {
		return "", ErrBadPath
	}
	clean := filepath.Clean("/" + filepath.ToSlash(rel)) // fuerza raíz y elimina ".."
	full := filepath.Join(base, clean)
	b := filepath.Clean(base)
	if full != b && !strings.HasPrefix(full, b+string(os.PathSeparator)) {
		return "", ErrBadPath
	}
	return full, nil
}

func (s *FSStore) List(_ context.Context, ses Sesion, carpeta string) ([]FileInfo, error) {
	root, err := s.userRoot(ses.UID)
	if err != nil {
		return nil, err
	}
	desde := root
	if carpeta != "" {
		if desde, err = safeJoin(root, carpeta); err != nil {
			return nil, err
		}
	}
	var out []FileInfo
	err = filepath.WalkDir(desde, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		info, err := d.Info()
		if err != nil {
			return err
		}
		h, err := HashFile(p)
		if err != nil {
			return err
		}
		out = append(out, FileInfo{Rel: filepath.ToSlash(rel), Hash: h, Mtime: info.ModTime().Unix(), Size: info.Size()})
		return nil
	})
	if os.IsNotExist(err) {
		return nil, nil
	}
	return out, err
}

func (s *FSStore) OpenRead(_ context.Context, ses Sesion, rel string) (io.ReadCloser, error) {
	root, err := s.userRoot(ses.UID)
	if err != nil {
		return nil, err
	}
	full, err := safeJoin(root, rel)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(full)
	if os.IsNotExist(err) {
		return nil, ErrNotFound
	}
	return f, err
}

func (s *FSStore) Save(_ context.Context, ses Sesion, rel string, r io.Reader) (int64, error) {
	root, err := s.userRoot(ses.UID)
	if err != nil {
		return 0, err
	}
	full, err := safeJoin(root, rel)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return 0, err
	}
	tmp, err := os.CreateTemp(filepath.Dir(full), ".upload-*")
	if err != nil {
		return 0, err
	}
	tmpName := tmp.Name()
	n, err := io.Copy(tmp, r)
	_ = tmp.Close()
	if err != nil {
		_ = os.Remove(tmpName)
		return 0, err
	}
	if err := os.Rename(tmpName, full); err != nil {
		_ = os.Remove(tmpName)
		return 0, err
	}
	return n, nil
}

func (s *FSStore) Delete(_ context.Context, ses Sesion, rel string) error {
	root, err := s.userRoot(ses.UID)
	if err != nil {
		return err
	}
	full, err := safeJoin(root, rel)
	if err != nil {
		return err
	}
	err = os.Remove(full)
	if os.IsNotExist(err) {
		return ErrNotFound
	}
	return err
}

func (s *FSStore) Count(_ context.Context, ses Sesion) (int, error) {
	root, err := s.userRoot(ses.UID)
	if err != nil {
		return 0, err
	}
	n := 0
	err = filepath.WalkDir(root, func(_ string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			n++
		}
		return nil
	})
	return n, err
}
