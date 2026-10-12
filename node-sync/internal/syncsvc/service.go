// Package syncsvc implementa el servicio gRPC FileSync definido en filesync.proto.
// Es la capa de presentación: traduce gRPC <-> dominio y errores de almacén ->
// códigos gRPC. Las reglas (qué subir, qué bajar) viven en internal/dominio.
package syncsvc

import (
	"context"
	"errors"
	"io"
	"log"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"upbcientifica/node-sync/internal/auth"
	"upbcientifica/node-sync/internal/dominio"
	"upbcientifica/node-sync/internal/storage"
	pb "upbcientifica/node-sync/proto/filesync"
)

type Service struct {
	pb.UnimplementedFileSyncServer
	store storage.Store
}

func New(store storage.Store) *Service { return &Service{store: store} }

// sesion devuelve el usuario del token validado por el interceptor.
//
// TODOS los métodos la usan. Antes DescargarArchivo y EstadoSync tomaban el uid
// del CUERPO del mensaje (req.Uid), lo que permitía a cualquier usuario
// autenticado leer el Home de otro con solo poner su uid. Los campos `uid`
// siguen en el .proto por compatibilidad de números de campo, pero el servidor
// los ignora.
func sesion(ctx context.Context) (storage.Sesion, error) {
	u, ok := auth.UsuarioFrom(ctx)
	if !ok || u.UID == "" {
		return storage.Sesion{}, status.Error(codes.Unauthenticated, "sin usuario autenticado")
	}
	return storage.Sesion{UID: u.UID, Token: u.Token}, nil
}

// aGRPC traduce los errores del almacén. Donde el Contrato_FileSync define un
// código (SYNC-002 ruta sin permiso, SYNC-004 Storage no disponible, SYNC-005
// checksum inválido) va como prefijo del mensaje para que el cliente lo
// muestre tal cual; para el resto el código gRPC basta.
func aGRPC(err error, que string) error {
	switch {
	case errors.Is(err, dominio.ErrChecksum):
		return status.Errorf(codes.InvalidArgument, "SYNC-005 %s: %v", que, err)
	case errors.Is(err, storage.ErrBadPath), errors.Is(err, dominio.ErrRutaInvalida):
		return status.Errorf(codes.InvalidArgument, "%s: %v", que, err)
	case errors.Is(err, storage.ErrNotFound):
		return status.Errorf(codes.NotFound, "%s: no existe en el servidor", que)
	case errors.Is(err, storage.ErrPermiso):
		return status.Errorf(codes.PermissionDenied, "SYNC-002 %s: %v", que, err)
	case errors.Is(err, storage.ErrCuota):
		return status.Errorf(codes.ResourceExhausted, "%s: %v", que, err)
	case errors.Is(err, storage.ErrNoAutorizado):
		return status.Errorf(codes.Unauthenticated, "%s: Storage rechazo la sesion", que)
	case errors.Is(err, storage.ErrNoDisponible):
		return status.Errorf(codes.Unavailable, "SYNC-004 %s: %v", que, err)
	case errors.Is(err, context.Canceled):
		return status.Errorf(codes.Canceled, "%s: cancelado", que)
	case errors.Is(err, context.DeadlineExceeded):
		return status.Errorf(codes.DeadlineExceeded, "%s: tiempo agotado", que)
	}
	return status.Errorf(codes.Internal, "%s: %v", que, err)
}

func ruta(r string) (string, error) {
	limpia, err := dominio.NormalizarRuta(r)
	if err != nil {
		return "", aGRPC(err, "ruta "+r)
	}
	return limpia, nil
}

var aAccionPB = map[dominio.Accion]pb.Accion{
	dominio.Igual:          pb.Accion_IGUAL,
	dominio.Subir:          pb.Accion_SUBIR,
	dominio.Bajar:          pb.Accion_BAJAR,
	dominio.Borrar:         pb.Accion_BORRAR,
	dominio.Conflicto:      pb.Accion_CONFLICTO,
	dominio.BorrarServidor: pb.Accion_BORRAR_SERVIDOR,
}

// IniciarSync compara el estado del dispositivo con su carpeta del Home y
// devuelve qué hacer con cada archivo (ver dominio.Planificar).
func (s *Service) IniciarSync(ctx context.Context, req *pb.SyncRequest) (*pb.SyncResponse, error) {
	ses, err := sesion(ctx)
	if err != nil {
		return nil, err
	}

	carpeta := ""
	if strings.Trim(req.Carpeta, "/ ") != "" {
		if carpeta, err = ruta(req.Carpeta); err != nil {
			return nil, err
		}
	}

	locales := make([]dominio.ArchivoLocal, 0, len(req.Archivos))
	for _, f := range req.Archivos {
		r, err := ruta(f.Ruta)
		if err != nil {
			return nil, err
		}
		if !dominio.DentroDe(carpeta, r) {
			return nil, status.Errorf(codes.PermissionDenied,
				"SYNC-002 %q no esta dentro de la carpeta sincronizada %q", r, carpeta)
		}
		if !f.Eliminado {
			if err := dominio.ValidarChecksum(f.Hash); err != nil {
				return nil, aGRPC(err, r)
			}
		}
		locales = append(locales, dominio.ArchivoLocal{
			Ruta: r, Hash: f.Hash, HashBase: f.HashBase, Eliminado: f.Eliminado,
		})
	}

	enServidor, err := s.store.List(ctx, ses, carpeta)
	if err != nil {
		return nil, aGRPC(err, "listando el Home")
	}
	servidor := make([]dominio.ArchivoServidor, len(enServidor))
	for i, f := range enServidor {
		servidor[i] = dominio.ArchivoServidor{Ruta: f.Rel, Hash: f.Hash}
	}

	plan := dominio.Planificar(locales, servidor, req.Dispositivo, time.Now())
	acciones := make([]*pb.AccionArchivo, len(plan))
	pendientes := 0
	for i, d := range plan {
		acciones[i] = &pb.AccionArchivo{
			Ruta: d.Ruta, Accion: aAccionPB[d.Accion],
			HashServidor: d.HashServidor, RutaConflicto: d.RutaConflicto,
		}
		if d.Accion != dominio.Igual {
			pendientes++
		}
	}

	s.store.Touch(ses.UID)
	log.Printf("sync uid=%s dispositivo=%q carpeta=%q modo=%s locales=%d servidor=%d pendientes=%d",
		ses.UID, req.Dispositivo, carpeta, req.ModoDisparo, len(locales), len(servidor), pendientes)
	return &pb.SyncResponse{Acciones: acciones, Version: s.store.Version(ses.UID)}, nil
}

// SubirArchivo recibe un archivo por streaming. El PRIMER mensaje debe traer
// la ruta; los siguientes traen los fragmentos de contenido.
func (s *Service) SubirArchivo(stream pb.FileSync_SubirArchivoServer) error {
	ses, err := sesion(stream.Context())
	if err != nil {
		return err
	}

	first, err := stream.Recv()
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "sin datos: %v", err)
	}
	r, err := ruta(first.Ruta)
	if err != nil {
		return err
	}

	n, err := s.store.Save(stream.Context(), ses, r, &streamReader{buf: first.Contenido, stream: stream})
	if err != nil {
		return aGRPC(err, "guardando "+r)
	}
	ver := s.store.BumpVersion(ses.UID)
	log.Printf("subida uid=%s ruta=%s bytes=%d version=%d", ses.UID, r, n, ver)
	return stream.SendAndClose(&pb.UploadStatus{
		Ok: true, Ruta: r, Version: ver, Mensaje: "archivo almacenado",
	})
}

// DescargarArchivo envía un archivo del Home por streaming.
func (s *Service) DescargarArchivo(req *pb.DownloadRequest, stream pb.FileSync_DescargarArchivoServer) error {
	ses, err := sesion(stream.Context())
	if err != nil {
		return err
	}
	r, err := ruta(req.Ruta)
	if err != nil {
		return err
	}

	rc, err := s.store.OpenRead(stream.Context(), ses, r)
	if err != nil {
		return aGRPC(err, "abriendo "+r)
	}
	defer rc.Close()

	buf := make([]byte, 64*1024)
	for {
		n, err := rc.Read(buf)
		if n > 0 {
			if serr := stream.Send(&pb.FileChunk{Ruta: r, Contenido: buf[:n]}); serr != nil {
				return serr
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return aGRPC(err, "leyendo "+r)
		}
	}
	return nil
}

// EliminarArchivo borra un archivo del Home (se borró en el dispositivo).
func (s *Service) EliminarArchivo(ctx context.Context, req *pb.EliminarRequest) (*pb.UploadStatus, error) {
	ses, err := sesion(ctx)
	if err != nil {
		return nil, err
	}
	r, err := ruta(req.Ruta)
	if err != nil {
		return nil, err
	}
	if err := s.store.Delete(ctx, ses, r); err != nil {
		return nil, aGRPC(err, "eliminando "+r)
	}
	ver := s.store.BumpVersion(ses.UID)
	log.Printf("borrado uid=%s ruta=%s version=%d", ses.UID, r, ver)
	return &pb.UploadStatus{Ok: true, Ruta: r, Version: ver, Mensaje: "archivo eliminado"}, nil
}

// EstadoSync devuelve versión, última sincronización y número de archivos.
func (s *Service) EstadoSync(ctx context.Context, _ *pb.EstadoRequest) (*pb.EstadoResponse, error) {
	ses, err := sesion(ctx)
	if err != nil {
		return nil, err
	}

	n, err := s.store.Count(ctx, ses)
	if err != nil {
		return nil, aGRPC(err, "contando archivos")
	}
	return &pb.EstadoResponse{
		Version:    s.store.Version(ses.UID),
		UltimaSync: s.store.LastSync(ses.UID),
		Archivos:   int32(n),
	}, nil
}

// streamReader adapta el stream de fragmentos entrante a un io.Reader.
type streamReader struct {
	buf    []byte
	stream pb.FileSync_SubirArchivoServer
	done   bool
}

func (r *streamReader) Read(p []byte) (int, error) {
	for len(r.buf) == 0 {
		if r.done {
			return 0, io.EOF
		}
		msg, err := r.stream.Recv()
		if err == io.EOF {
			r.done = true
			return 0, io.EOF
		}
		if err != nil {
			return 0, err
		}
		r.buf = msg.Contenido
	}
	n := copy(p, r.buf)
	r.buf = r.buf[n:]
	return n, nil
}
