// Package storage define la capa de almacenamiento del servicio de
// sincronización. La interfaz Store permite sustituir la implementación
// (hoy: sistema de archivos local / NFS) sin tocar la lógica del servicio.
package storage

import (
	"errors"
	"io"
)

var (
	ErrBadPath  = errors.New("ruta invalida")
	ErrNotFound = errors.New("archivo no encontrado")
)

// FileInfo describe un archivo del Home de un usuario.
type FileInfo struct {
	Rel   string // ruta relativa dentro del Home
	Hash  string // SHA-256 hex
	Mtime int64  // época Unix (segundos)
	Size  int64  // bytes
}

// Store abstrae el almacenamiento de los Home de usuario y sus metadatos.
type Store interface {
	List(uid string) ([]FileInfo, error)
	OpenRead(uid, rel string) (io.ReadCloser, error)
	Save(uid, rel string, r io.Reader) (int64, error)
	Delete(uid, rel string) error
	Count(uid string) (int, error)
	Version(uid string) int64
	BumpVersion(uid string) int64
	LastSync(uid string) int64
	Touch(uid string)
}
