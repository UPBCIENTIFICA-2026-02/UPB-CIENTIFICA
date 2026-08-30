// Package syncsvc implementa el servicio gRPC FileSync definido en filesync.proto.
package syncsvc

import (
	"context"
	"io"
	"log"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"upbcientifica/node-sync/internal/storage"
	pb "upbcientifica/node-sync/proto/filesync"
)

type Service struct {
	pb.UnimplementedFileSyncServer
	store storage.Store
}

func New(store storage.Store) *Service { return &Service{store: store} }

// IniciarSync compara el estado local del cliente con el Home del servidor.
// Politica (version inicial, sin resolucion avanzada de conflictos):
//   - solo en cliente        -> SUBIR
//   - solo en servidor       -> BAJAR
//   - en ambos, hash igual   -> IGUAL
//   - en ambos, hash difiere -> SUBIR (prevalece el cambio del cliente)
func (s *Service) IniciarSync(ctx context.Context, req *pb.SyncRequest) (*pb.SyncResponse, error) {
	if req.Uid == "" {
		return nil, status.Error(codes.InvalidArgument, "uid requerido")
	}
	serverList, err := s.store.List(req.Uid)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "listando Home: %v", err)
	}

	srv := make(map[string]string, len(serverList))
	for _, f := range serverList {
		srv[f.Rel] = f.Hash
	}

	var acciones []*pb.AccionArchivo
	seen := make(map[string]bool, len(req.Archivos))
	for _, f := range req.Archivos {
		seen[f.Ruta] = true
		shash, ok := srv[f.Ruta]
		switch {
		case !ok:
			acciones = append(acciones, &pb.AccionArchivo{Ruta: f.Ruta, Accion: pb.Accion_SUBIR})
		case shash == f.Hash:
			acciones = append(acciones, &pb.AccionArchivo{Ruta: f.Ruta, Accion: pb.Accion_IGUAL, HashServidor: shash})
		default:
			acciones = append(acciones, &pb.AccionArchivo{Ruta: f.Ruta, Accion: pb.Accion_SUBIR, HashServidor: shash})
		}
	}
	for ruta, shash := range srv {
		if !seen[ruta] {
			acciones = append(acciones, &pb.AccionArchivo{Ruta: ruta, Accion: pb.Accion_BAJAR, HashServidor: shash})
		}
	}

	s.store.Touch(req.Uid)
	return &pb.SyncResponse{Acciones: acciones, Version: s.store.Version(req.Uid)}, nil
}

// SubirArchivo recibe un archivo por streaming. El PRIMER mensaje debe traer
// uid y ruta; los siguientes traen los fragmentos de contenido.
func (s *Service) SubirArchivo(stream pb.FileSync_SubirArchivoServer) error {
	first, err := stream.Recv()
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "sin datos: %v", err)
	}
	if first.Uid == "" || first.Ruta == "" {
		return status.Error(codes.InvalidArgument, "el primer fragmento debe incluir uid y ruta")
	}

	r := &streamReader{buf: first.Contenido, stream: stream}
	n, err := s.store.Save(first.Uid, first.Ruta, r)
	if err != nil {
		if err == storage.ErrBadPath {
			return status.Error(codes.InvalidArgument, "ruta invalida")
		}
		return status.Errorf(codes.Internal, "guardando archivo: %v", err)
	}
	ver := s.store.BumpVersion(first.Uid)
	log.Printf("subida uid=%s ruta=%s bytes=%d version=%d", first.Uid, first.Ruta, n, ver)
	return stream.SendAndClose(&pb.UploadStatus{
		Ok: true, Ruta: first.Ruta, Version: ver, Mensaje: "archivo almacenado",
	})
}

// DescargarArchivo envia un archivo del Home por streaming.
func (s *Service) DescargarArchivo(req *pb.DownloadRequest, stream pb.FileSync_DescargarArchivoServer) error {
	if req.Uid == "" || req.Ruta == "" {
		return status.Error(codes.InvalidArgument, "uid y ruta requeridos")
	}
	rc, err := s.store.OpenRead(req.Uid, req.Ruta)
	if err != nil {
		switch err {
		case storage.ErrNotFound:
			return status.Error(codes.NotFound, "archivo no encontrado")
		case storage.ErrBadPath:
			return status.Error(codes.InvalidArgument, "ruta invalida")
		default:
			return status.Errorf(codes.Internal, "abriendo archivo: %v", err)
		}
	}
	defer rc.Close()

	buf := make([]byte, 64*1024)
	for {
		n, err := rc.Read(buf)
		if n > 0 {
			if serr := stream.Send(&pb.FileChunk{Uid: req.Uid, Ruta: req.Ruta, Contenido: buf[:n]}); serr != nil {
				return serr
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return status.Errorf(codes.Internal, "leyendo archivo: %v", err)
		}
	}
	return nil
}

// EstadoSync devuelve version, ultima sincronizacion y numero de archivos.
func (s *Service) EstadoSync(ctx context.Context, req *pb.EstadoRequest) (*pb.EstadoResponse, error) {
	if req.Uid == "" {
		return nil, status.Error(codes.InvalidArgument, "uid requerido")
	}
	n, err := s.store.Count(req.Uid)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "contando: %v", err)
	}
	return &pb.EstadoResponse{
		Version:    s.store.Version(req.Uid),
		UltimaSync: s.store.LastSync(req.Uid),
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
