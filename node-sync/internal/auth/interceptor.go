// Package auth valida el token emitido por Authentication Service (node-soap)
// y deja el uid autenticado en el contexto.
package auth

import (
	"context"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type ctxKey struct{}

// Validator permite intercambiar la estrategia de validacion sin tocar el
// servicio: hoy Mock, manana SOAP contra node-soap.
type Validator interface {
	Validate(ctx context.Context, token string) (uid string, err error)
}

// MockValidator acepta tokens "mock-token-<uid>-..." mientras node-soap no exista.
// Debe coincidir con el mock de Authentication usado por los demas clientes.
type MockValidator struct{}

func (MockValidator) Validate(_ context.Context, token string) (string, error) {
	if !strings.HasPrefix(token, "mock-token-") {
		return "", status.Error(codes.Unauthenticated, "token invalido")
	}
	partes := strings.Split(token, "-")
	if len(partes) < 3 || partes[2] == "" {
		return "", status.Error(codes.Unauthenticated, "token malformado")
	}
	return partes[2], nil
}

// TODO(node-soap): SOAPValidator que invoque validarToken del WSDL y devuelva
// el uid. Cachear el resultado unos segundos: la propuesta de arquitectura
// advierte que validar en cada RPC convierte a Auth en cuello de botella.

func UIDFrom(ctx context.Context) (string, bool) {
	uid, ok := ctx.Value(ctxKey{}).(string)
	return uid, ok
}

func extraerUID(ctx context.Context, v Validator) (string, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return "", status.Error(codes.Unauthenticated, "sin metadata")
	}
	valores := md.Get("authorization")
	if len(valores) == 0 {
		return "", status.Error(codes.Unauthenticated, "falta el header authorization")
	}
	return v.Validate(ctx, strings.TrimPrefix(valores[0], "Bearer "))
}

func UnaryInterceptor(v Validator) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, _ *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler) (interface{}, error) {
		uid, err := extraerUID(ctx, v)
		if err != nil {
			return nil, err
		}
		return handler(context.WithValue(ctx, ctxKey{}, uid), req)
	}
}

// wrappedStream permite sustituir el contexto en RPCs de streaming.
type wrappedStream struct {
	grpc.ServerStream
	ctx context.Context
}

func (w wrappedStream) Context() context.Context { return w.ctx }

func StreamInterceptor(v Validator) grpc.StreamServerInterceptor {
	return func(srv interface{}, ss grpc.ServerStream, _ *grpc.StreamServerInfo,
		handler grpc.StreamHandler) error {
		uid, err := extraerUID(ss.Context(), v)
		if err != nil {
			return err
		}
		return handler(srv, wrappedStream{ss, context.WithValue(ss.Context(), ctxKey{}, uid)})
	}
}