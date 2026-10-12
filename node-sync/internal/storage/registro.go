package storage

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// registro guarda en un JSON el estado propio de la sincronización (versión y
// última sincronización por usuario) y la caché de hashes de StorageStore.
//
// TODO(backend): pasar a PostgreSQL según el diseño (tabla SINCRONIZACION).
type registro struct {
	ruta string
	mu   sync.Mutex
	d    datosRegistro
}

type datosRegistro struct {
	Usuarios map[string]*meta `json:"usuarios"`
	// Hashes: "<id de Storage>@<versión>" -> SHA-256. Storage no guarda
	// checksums; sin esta caché habría que descargar el Home entero en cada
	// sincronización para compararlo. Como cada versión de Storage es
	// inmutable, el hash de un par (id, versión) no caduca nunca.
	Hashes map[string]string `json:"hashes,omitempty"`
}

type meta struct {
	Version  int64 `json:"version"`
	LastSync int64 `json:"last_sync"`
}

func nuevoRegistro(ruta string) *registro {
	r := &registro{ruta: ruta, d: datosRegistro{Usuarios: map[string]*meta{}, Hashes: map[string]string{}}}
	if b, err := os.ReadFile(ruta); err == nil {
		_ = json.Unmarshal(b, &r.d)
	}
	if r.d.Usuarios == nil {
		r.d.Usuarios = map[string]*meta{}
	}
	if r.d.Hashes == nil {
		r.d.Hashes = map[string]string{}
	}
	return r
}

// guardar se llama con mu tomado. Escribe a un temporal y renombra para no
// dejar el registro a medias si el proceso muere escribiendo.
func (r *registro) guardar() {
	b, _ := json.MarshalIndent(r.d, "", "  ")
	_ = os.MkdirAll(filepath.Dir(r.ruta), 0o755)
	tmp := r.ruta + ".tmp"
	if os.WriteFile(tmp, b, 0o644) == nil {
		_ = os.Rename(tmp, r.ruta)
	}
}

func (r *registro) metaDe(uid string) *meta {
	if r.d.Usuarios[uid] == nil {
		r.d.Usuarios[uid] = &meta{}
	}
	return r.d.Usuarios[uid]
}

func (r *registro) Version(uid string) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.metaDe(uid).Version
}

func (r *registro) BumpVersion(uid string) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.metaDe(uid)
	m.Version++
	m.LastSync = time.Now().Unix()
	r.guardar()
	return m.Version
}

func (r *registro) LastSync(uid string) int64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.metaDe(uid).LastSync
}

func (r *registro) Touch(uid string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.metaDe(uid).LastSync = time.Now().Unix()
	r.guardar()
}

func (r *registro) hash(clave string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	h, ok := r.d.Hashes[clave]
	return h, ok
}

func (r *registro) fijarHash(clave, h string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.d.Hashes[clave] = h
	r.guardar()
}
