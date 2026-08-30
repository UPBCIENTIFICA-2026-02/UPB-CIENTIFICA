// syncd: servidor gRPC de sincronizacion de archivos (nodo node-sync) de
// UPB-CIENTIFICA. Sirve por TLS cuando se configuran certificado y llave.
package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"

	"upbcientifica/node-sync/internal/config"
	"upbcientifica/node-sync/internal/storage"
	"upbcientifica/node-sync/internal/syncsvc"
	pb "upbcientifica/node-sync/proto/filesync"
)

func main() {
	cfg := config.Load()

	store, err := storage.NewFSStore(cfg.DataDir)
	if err != nil {
		log.Fatalf("almacenamiento (%s): %v", cfg.DataDir, err)
	}

	lis, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		log.Fatalf("no se pudo escuchar en %s: %v", cfg.Addr, err)
	}

	opts := []grpc.ServerOption{
		grpc.ChainUnaryInterceptor(loggingUnary),
		grpc.ChainStreamInterceptor(loggingStream),
	}
	if cfg.TLSEnabled() {
		creds, err := credentials.NewServerTLSFromFile(cfg.TLSCert, cfg.TLSKey)
		if err != nil {
			log.Fatalf("TLS: %v", err)
		}
		opts = append(opts, grpc.Creds(creds))
		log.Printf("TLS habilitado (cert=%s)", cfg.TLSCert)
	} else {
		log.Printf("ADVERTENCIA: TLS deshabilitado (solo desarrollo). En produccion use -tls-cert y -tls-key.")
	}

	grpcServer := grpc.NewServer(opts...)
	pb.RegisterFileSyncServer(grpcServer, syncsvc.New(store))

	log.Printf("syncd (node-sync) escuchando en %s (data=%s)", cfg.Addr, cfg.DataDir)

	go func() {
		if err := grpcServer.Serve(lis); err != nil {
			log.Fatalf("serve: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	log.Println("apagando syncd...")
	done := make(chan struct{})
	go func() { grpcServer.GracefulStop(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		grpcServer.Stop()
	}
}

// --- Interceptores ---
// TODO(backend): interceptor de autenticacion que valide el token (metadata
// "authorization") contra LDAP/OIDC (node-soap) antes de ejecutar el handler.
func loggingUnary(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	t := time.Now()
	resp, err := handler(ctx, req)
	log.Printf("unary  %s (%v) err=%v", info.FullMethod, time.Since(t), err)
	return resp, err
}

func loggingStream(srv interface{}, ss grpc.ServerStream, info *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
	t := time.Now()
	err := handler(srv, ss)
	log.Printf("stream %s (%v) err=%v", info.FullMethod, time.Since(t), err)
	return err
}
