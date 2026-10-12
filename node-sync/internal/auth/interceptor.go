// Package auth valida el token emitido por Authentication Service (node-soap)
// y deja el usuario autenticado en el contexto.
package auth

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type ctxKey struct{}

// Usuario es el resultado de validar un token.
//
// Antes Validate devolvia solo el uid. Se amplio a roles y grupos para que la
// forma coincida con la de node-repository y node-media ({ id, roles, grupos }):
// los GRUPOS son imprescindibles si algun dia sync tiene que respetar el modelo
// de permisos Unix de Storage, y con la firma anterior no habia donde ponerlos.
type Usuario struct {
	UID    string
	Roles  []string
	Grupos []string
	// Token ya validado. node-sync lo reenvía a Distributed Storage para
	// actuar EN NOMBRE del usuario (Storage aplica sus cuotas y permisos).
	Token string
}

// Validator permite intercambiar la estrategia de validacion sin tocar el
// servicio: Mock en desarrollo, SOAP contra node-soap en produccion.
type Validator interface {
	Validate(ctx context.Context, token string) (Usuario, error)
}

// MockValidator acepta tokens "mock-token-<uid>-..." para desarrollo local sin
// la VM de node-soap levantada. Debe coincidir con el validador simulado de
// node-repository y node-media.
type MockValidator struct{}

func (MockValidator) Validate(_ context.Context, token string) (Usuario, error) {
	if !strings.HasPrefix(token, "mock-token-") {
		return Usuario{}, status.Error(codes.Unauthenticated, "token invalido")
	}
	partes := strings.Split(token, "-")
	if len(partes) < 3 || partes[2] == "" {
		return Usuario{}, status.Error(codes.Unauthenticated, "token malformado")
	}
	return Usuario{
		UID:    partes[2],
		Roles:  []string{"investigador"},
		Grupos: []string{"usuarios"},
	}, nil
}

// --- Validador SOAP contra node-soap ---------------------------------------

type entradaCache struct {
	usuario Usuario
	valido  bool
	vence   time.Time
}

// SOAPValidator invoca la operacion validarToken del WSDL de node-soap.
//
// CACHE: la propuesta de arquitectura advierte que validar en cada RPC
// convierte a Auth en cuello de botella. Se cachea unos segundos: es el tiempo
// maximo que un token revocado seguiria siendo aceptado, y a cambio una sesion
// de sincronizacion completa cuesta una sola llamada SOAP.
type SOAPValidator struct {
	url       string
	namespace string
	ttl       time.Duration
	cliente   *http.Client

	mu    sync.Mutex
	cache map[string]entradaCache
}

// NewSOAPValidator construye el validador.
//
// rutaCA es opcional: si node-soap sirve HTTPS con un certificado firmado por
// una CA propia (lo habitual en el CCA), hay que pasar el .crt de esa CA o la
// conexion se rechaza por certificado desconocido. Vacio = raices del sistema.
func NewSOAPValidator(url, namespace, rutaCA string, ttl time.Duration) (*SOAPValidator, error) {
	transporte := &http.Transport{}

	if rutaCA != "" {
		pem, err := os.ReadFile(rutaCA)
		if err != nil {
			return nil, fmt.Errorf("leyendo la CA de auth (%s): %w", rutaCA, err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("la CA de auth (%s) no contiene certificados PEM validos", rutaCA)
		}
		transporte.TLSClientConfig = &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}
	}

	if ttl <= 0 {
		ttl = 5 * time.Second
	}

	return &SOAPValidator{
		url:       url,
		namespace: namespace,
		ttl:       ttl,
		cliente:   &http.Client{Timeout: 5 * time.Second, Transport: transporte},
		cache:     map[string]entradaCache{},
	}, nil
}

// Estructura de la respuesta. Las etiquetas no llevan namespace a proposito:
// encoding/xml casa por nombre local, y PHP SoapServer devuelve prefijos que
// cambian entre peticiones (ns1:, SOAP-ENV:...).
type sobreRespuesta struct {
	XMLName xml.Name `xml:"Envelope"`
	Body    struct {
		Respuesta struct {
			Valido   bool     `xml:"valido"`
			UID      string   `xml:"uid"`
			Roles    []string `xml:"roles"`
			Grupos   []string `xml:"grupos"`
			ExpiraEn int64    `xml:"expiraEn"`
		} `xml:"validarTokenResponse"`
	} `xml:"Body"`
}

func (v *SOAPValidator) deCache(token string) (entradaCache, bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	e, ok := v.cache[token]
	if !ok || time.Now().After(e.vence) {
		delete(v.cache, token)
		return entradaCache{}, false
	}
	return e, true
}

func (v *SOAPValidator) aCache(token string, u Usuario, valido bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	// Tope simple para que la cache no crezca sin limite.
	if len(v.cache) > 1000 {
		v.cache = map[string]entradaCache{}
	}
	v.cache[token] = entradaCache{usuario: u, valido: valido, vence: time.Now().Add(v.ttl)}
}

func (v *SOAPValidator) Validate(ctx context.Context, token string) (Usuario, error) {
	if token == "" {
		return Usuario{}, status.Error(codes.Unauthenticated, "token ausente")
	}

	if e, ok := v.deCache(token); ok {
		if !e.valido {
			return Usuario{}, status.Error(codes.Unauthenticated, "token invalido o expirado")
		}
		return e.usuario, nil
	}

	// El elemento de la operacion va en el namespace del WSDL, pero sus HIJOS
	// no: el esquema de users.wsdl no declara elementFormDefault, asi que rige
	// "unqualified". Por eso se usa un prefijo (ns:) y no xmlns= por defecto,
	// que haria que <token> heredara el namespace y quedara cualificado.
	cuerpo := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:validarToken xmlns:ns="%s">
      <token>%s</token>
    </ns:validarToken>
  </soap:Body>
</soap:Envelope>`, v.namespace, escaparXML(token))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.url, strings.NewReader(cuerpo))
	if err != nil {
		return Usuario{}, status.Errorf(codes.Internal, "construyendo la peticion a Auth: %v", err)
	}
	req.Header.Set("Content-Type", "text/xml; charset=utf-8")
	req.Header.Set("SOAPAction", v.namespace+"/validarToken")

	resp, err := v.cliente.Do(req)
	if err != nil {
		// Auth caido NO es "token invalido": son codigos distintos, y
		// confundirlos hace que el cliente borre una sesion que sigue siendo
		// buena. Unavailable se traduce a un reintento, Unauthenticated a un
		// nuevo login.
		return Usuario{}, status.Errorf(codes.Unavailable, "Authentication Service no responde: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return Usuario{}, status.Errorf(codes.Unavailable, "Authentication Service respondio %d", resp.StatusCode)
	}

	crudo, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Usuario{}, status.Errorf(codes.Unavailable, "leyendo la respuesta de Auth: %v", err)
	}

	var sobre sobreRespuesta
	if err := xml.Unmarshal(crudo, &sobre); err != nil {
		return Usuario{}, status.Errorf(codes.Internal, "respuesta de Auth ilegible: %v", err)
	}

	r := sobre.Body.Respuesta

	if !r.Valido {
		// Se cachea tambien el rechazo, para que un cliente con un token viejo
		// no golpee a Auth en cada reintento.
		v.aCache(token, Usuario{}, false)
		return Usuario{}, status.Error(codes.Unauthenticated, "token invalido o expirado")
	}

	if r.UID == "" {
		// valido=true sin uid es un contrato roto, no un token malo.
		return Usuario{}, status.Error(codes.Internal, "Auth devolvio valido=true sin uid")
	}

	u := Usuario{UID: r.UID, Roles: r.Roles, Grupos: r.Grupos}
	v.aCache(token, u, true)
	return u, nil
}

func escaparXML(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

// --- Contexto e interceptores ---------------------------------------------

// UsuarioFrom devuelve el usuario autenticado que dejo el interceptor.
func UsuarioFrom(ctx context.Context) (Usuario, bool) {
	u, ok := ctx.Value(ctxKey{}).(Usuario)
	return u, ok
}

// UIDFrom es un atajo para el caso habitual: solo el uid.
func UIDFrom(ctx context.Context) (string, bool) {
	u, ok := UsuarioFrom(ctx)
	return u.UID, ok
}

func extraerUsuario(ctx context.Context, v Validator) (Usuario, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return Usuario{}, status.Error(codes.Unauthenticated, "sin metadata")
	}
	valores := md.Get("authorization")
	if len(valores) == 0 {
		return Usuario{}, status.Error(codes.Unauthenticated, "falta el header authorization")
	}
	token := strings.TrimPrefix(valores[0], "Bearer ")
	u, err := v.Validate(ctx, token)
	if err != nil {
		return Usuario{}, err
	}
	u.Token = token
	return u, nil
}

func UnaryInterceptor(v Validator) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, _ *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler) (interface{}, error) {
		u, err := extraerUsuario(ctx, v)
		if err != nil {
			return nil, err
		}
		return handler(context.WithValue(ctx, ctxKey{}, u), req)
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
		u, err := extraerUsuario(ss.Context(), v)
		if err != nil {
			return err
		}
		return handler(srv, wrappedStream{ss, context.WithValue(ss.Context(), ctxKey{}, u)})
	}
}
