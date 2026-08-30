package storage

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// FSStore implementa Store sobre el sistema de archivos. En producción, la
// carpeta base es el punto de montaje NFS (p. ej. /srv/upbcientifica/home).
//
// TODO(backend): sustituir el almacén de metadatos (versión/última sync) por
// PostgreSQL, según el diseño (tabla SINCRONIZACION).
type FSStore struct {
	base     string
	metaPath string
	mu       sync.Mutex
	m        map[string]*meta
}

type meta struct {
	Version  int64 `json:"version"`
	LastSync int64 `json:"last_sync"`
}

func NewFSStore(base string) (*FSStore, error) {
	if err := os.MkdirAll(base, 0o755); err != nil {
		return nil, err
	}
	s := &FSStore{
		base:     base,
		metaPath: filepath.Join(base, ".sync-meta.json"),
		m:        map[string]*meta{},
	}
	s.load()
	return s, nil
}

func (s *FSStore) load() {
	b, err := os.ReadFile(s.metaPath)
	if err != nil {
		return
	}
	_ = json.Unmarshal(b, &s.m)
}

func (s *FSStore) persist() {
	b, _ := json.MarshalIndent(s.m, "", "  ")
	_ = os.WriteFile(s.metaPath, b, 0o644)
}

func (s *FSStore) metaOf(uid string) *meta {
	if s.m[uid] == nil {
		s.m[uid] = &meta{}
	}
	return s.m[uid]
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

func (s *FSStore) List(uid string) ([]FileInfo, error) {
	root, err := s.userRoot(uid)
	if err != nil {
		return nil, err
	}
	var out []FileInfo
	err = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, p)
		rel = filepath.ToSlash(rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		h, err := HashFile(p)
		if err != nil {
			return err
		}
		out = append(out, FileInfo{Rel: rel, Hash: h, Mtime: info.ModTime().Unix(), Size: info.Size()})
		return nil
	})
	return out, err
}

func (s *FSStore) OpenRead(uid, rel string) (io.ReadCloser, error) {
	root, err := s.userRoot(uid)
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

func (s *FSStore) Save(uid, rel string, r io.Reader) (int64, error) {
	root, err := s.userRoot(uid)
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

func (s *FSStore) Delete(uid, rel string) error {
	root, err := s.userRoot(uid)
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

func (s *FSStore) Count(uid string) (int, error) {
	root, err := s.userRoot(uid)
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

func (s *FSStore) Version(uid string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.metaOf(uid).Version
}

func (s *FSStore) BumpVersion(uid string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	m := s.metaOf(uid)
	m.Version++
	m.LastSync = time.Now().Unix()
	s.persist()
	return m.Version
}

func (s *FSStore) LastSync(uid string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.metaOf(uid).LastSync
}

func (s *FSStore) Touch(uid string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.metaOf(uid).LastSync = time.Now().Unix()
	s.persist()
}
