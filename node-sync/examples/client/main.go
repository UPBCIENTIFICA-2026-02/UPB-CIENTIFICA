// Cliente de prueba de extremo a extremo para syncd (node-sync). Simula el
// comportamiento de fsagent: escanea una carpeta local, pide la sincronizacion,
// sube lo que falte y baja lo que el servidor tenga de mas.
//
// TLS: si SYNC_TLS_CA apunta a un certificado (PEM), se conecta por TLS usando
// ese CA; en caso contrario se conecta sin cifrar (solo para desarrollo).
package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"

	pb "upbcientifica/node-sync/proto/filesync"
)

func main() {
	addr := envDef("SYNC_ADDR", "localhost:50051")
	dir := envDef("SYNC_CLIENT_DIR", "./client-data")
	uid := envDef("SYNC_UID", "jperez")

	creds := transportCreds()
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(creds))
	if err != nil {
		log.Fatalf("conexion: %v", err)
	}
	defer conn.Close()
	cli := pb.NewFileSyncClient(conn)

	metas, err := scan(dir)
	if err != nil {
		log.Fatalf("escaneo: %v", err)
	}
	fmt.Printf("Cliente: %d archivo(s) en %s\n", len(metas), dir)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	resp, err := cli.IniciarSync(ctx, &pb.SyncRequest{Uid: uid, Dispositivo: "fsagent-demo", Archivos: metas})
	if err != nil {
		log.Fatalf("IniciarSync: %v", err)
	}
	fmt.Printf("Servidor: version=%d, %d accion(es):\n", resp.Version, len(resp.Acciones))
	for _, a := range resp.Acciones {
		fmt.Printf("  - %-26s %s\n", a.Ruta, a.Accion)
	}

	for _, a := range resp.Acciones {
		if a.Accion == pb.Accion_SUBIR {
			if err := subir(ctx, cli, uid, dir, a.Ruta); err != nil {
				log.Fatalf("subir %s: %v", a.Ruta, err)
			}
			fmt.Printf("  subido: %s\n", a.Ruta)
		}
	}
	for _, a := range resp.Acciones {
		if a.Accion == pb.Accion_BAJAR {
			if err := bajar(ctx, cli, uid, dir, a.Ruta); err != nil {
				log.Fatalf("bajar %s: %v", a.Ruta, err)
			}
			fmt.Printf("  bajado: %s\n", a.Ruta)
		}
	}

	est, err := cli.EstadoSync(ctx, &pb.EstadoRequest{Uid: uid, Dispositivo: "fsagent-demo"})
	if err != nil {
		log.Fatalf("EstadoSync: %v", err)
	}
	fmt.Printf("Estado: version=%d archivos=%d ultimaSync=%d\n", est.Version, est.Archivos, est.UltimaSync)
}

func transportCreds() credentials.TransportCredentials {
	if ca := os.Getenv("SYNC_TLS_CA"); ca != "" {
		c, err := credentials.NewClientTLSFromFile(ca, os.Getenv("SYNC_TLS_SERVERNAME"))
		if err != nil {
			log.Fatalf("TLS CA: %v", err)
		}
		return c
	}
	return insecure.NewCredentials()
}

func subir(ctx context.Context, cli pb.FileSyncClient, uid, base, rel string) error {
	f, err := os.Open(filepath.Join(base, rel))
	if err != nil {
		return err
	}
	defer f.Close()
	stream, err := cli.SubirArchivo(ctx)
	if err != nil {
		return err
	}
	buf := make([]byte, 32*1024)
	first := true
	for {
		n, err := f.Read(buf)
		if n > 0 {
			ch := &pb.FileChunk{Contenido: append([]byte(nil), buf[:n]...)}
			if first {
				ch.Uid, ch.Ruta, first = uid, rel, false
			}
			if serr := stream.Send(ch); serr != nil {
				return serr
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	if first { // archivo vacio: enviar al menos la metadata
		if serr := stream.Send(&pb.FileChunk{Uid: uid, Ruta: rel}); serr != nil {
			return serr
		}
	}
	_, err = stream.CloseAndRecv()
	return err
}

func bajar(ctx context.Context, cli pb.FileSyncClient, uid, base, rel string) error {
	stream, err := cli.DescargarArchivo(ctx, &pb.DownloadRequest{Uid: uid, Ruta: rel})
	if err != nil {
		return err
	}
	dst := filepath.Join(base, rel)
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	for {
		ch, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if _, werr := f.Write(ch.Contenido); werr != nil {
			return werr
		}
	}
	return nil
}

func scan(dir string) ([]*pb.FileMeta, error) {
	var out []*pb.FileMeta
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		rel = filepath.ToSlash(rel)
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(b)
		info, _ := d.Info()
		out = append(out, &pb.FileMeta{
			Ruta: rel, Hash: hex.EncodeToString(sum[:]),
			Mtime: info.ModTime().Unix(), Size: info.Size(),
		})
		return nil
	})
	if os.IsNotExist(err) {
		return out, nil
	}
	return out, err
}

func envDef(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
