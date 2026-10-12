// Package storage define la capa de almacenamiento del servicio de
// sincronización. La interfaz Store permite sustituir la implementación sin
// tocar la lógica del servicio:
//
//   - StorageStore (por defecto): guarda a través de la API REST de
//     Distributed Storage (node-repository) con el token del usuario.
//   - FSStore: escribe directo en el Home (NFS). Solo para desarrollo aislado.
package storage

import (
	"context"
	"errors"
	"io"
)

var (
	ErrBadPath      = errors.New("ruta invalida")
	ErrNotFound     = errors.New("archivo no encontrado")
	ErrPermiso      = errors.New("permiso denegado")
	ErrCuota        = errors.New("cuota excedida")
	ErrNoAutorizado = errors.New("token rechazado por Storage")
	ErrNoDisponible = errors.New("Storage no disponible")
)

// Sesion identifica a quien sincroniza. El Token hace falta para hablar con
// Storage EN NOMBRE del usuario: así Storage aplica sus cuotas y permisos y
// node-sync no necesita ningún privilegio propio.
type Sesion struct {
	UID   string
	Token string
}

// FileInfo describe un archivo del Home de un usuario.
type FileInfo struct {
	Rel   string // ruta relativa al Home ("Respaldo celular/foto.jpg")
	Hash  string // SHA-256 hex
	Mtime int64  // época Unix (segundos); 0 si el almacén no lo conoce
	Size  int64  // bytes
}

// Store abstrae el almacenamiento de los Home de usuario y sus metadatos.
// Todas las rutas son relativas al Home, con "/" como separador.
type Store interface {
	// List devuelve los archivos dentro de `carpeta` ("" = todo el Home).
	List(ctx context.Context, s Sesion, carpeta string) ([]FileInfo, error)
	OpenRead(ctx context.Context, s Sesion, rel string) (io.ReadCloser, error)
	Save(ctx context.Context, s Sesion, rel string, r io.Reader) (int64, error)
	Delete(ctx context.Context, s Sesion, rel string) error
	Count(ctx context.Context, s Sesion) (int, error)

	Version(uid string) int64
	BumpVersion(uid string) int64
	LastSync(uid string) int64
	Touch(uid string)
}
