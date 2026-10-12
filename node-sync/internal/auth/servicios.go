package auth

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Mapa de servicios autorizados (D2).
//
// ANTES node-sync solo validaba el token: el login devolvia
// mapaServiciosAutorizados pero ningun servicio lo exigia, asi que un perfil
// sin "filesync" sincronizaba igual. AHORA, ademas de validar el token, el
// interceptor pregunta a Authentication con validarAccesoServicio(usuario,
// servicio) de users.wsdl. Es la misma regla que aplican node-repository,
// node-media y node-shared-file.

// Autorizador decide si el perfil de un usuario puede usar un servicio.
type Autorizador interface {
	AutorizarServicio(ctx context.Context, uid, servicio string) (bool, error)
}

// AutorizarServicio en modo simulado: sin directorio no hay mapa que
// consultar, todo usuario puede usar todo.
func (MockValidator) AutorizarServicio(context.Context, string, string) (bool, error) {
	return true, nil
}

type entradaAcceso struct {
	permitido bool
	vence     time.Time
}

// accesosSOAP es la cache de respuestas por (uid, servicio). Un minuto: el
// mapa cambia muy rara vez y asi no se suma una llamada SOAP a cada RPC.
type accesosSOAP struct {
	mu sync.Mutex
	m  map[string]entradaAcceso
}

var cacheAccesos = &accesosSOAP{m: map[string]entradaAcceso{}}

type sobreAcceso struct {
	XMLName xml.Name `xml:"Envelope"`
	Body    struct {
		Respuesta struct {
			Success bool `xml:"success"`
		} `xml:"validarAccesoServicioResponse"`
	} `xml:"Body"`
}

// AutorizarServicio llama a validarAccesoServicio. Si Auth no responde
// devuelve Unavailable: nunca se concede el acceso por defecto.
func (v *SOAPValidator) AutorizarServicio(ctx context.Context, uid, servicio string) (bool, error) {
	clave := uid + "|" + servicio
	cacheAccesos.mu.Lock()
	if e, ok := cacheAccesos.m[clave]; ok && time.Now().Before(e.vence) {
		cacheAccesos.mu.Unlock()
		return e.permitido, nil
	}
	cacheAccesos.mu.Unlock()

	cuerpo := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns:validarAccesoServicio xmlns:ns="%s">
      <usuario>%s</usuario>
      <servicio>%s</servicio>
    </ns:validarAccesoServicio>
  </soap:Body>
</soap:Envelope>`, v.namespace, escaparXML(uid), escaparXML(servicio))

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.url, strings.NewReader(cuerpo))
	if err != nil {
		return false, status.Errorf(codes.Internal, "construyendo la peticion a Auth: %v", err)
	}
	req.Header.Set("Content-Type", "text/xml; charset=utf-8")
	req.Header.Set("SOAPAction", v.namespace+"/validarAccesoServicio")

	resp, err := v.cliente.Do(req)
	if err != nil {
		return false, status.Errorf(codes.Unavailable, "Authentication Service no responde: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, status.Errorf(codes.Unavailable, "Authentication Service respondio %d a validarAccesoServicio", resp.StatusCode)
	}
	crudo, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return false, status.Errorf(codes.Unavailable, "leyendo la respuesta de Auth: %v", err)
	}
	var sobre sobreAcceso
	if err := xml.Unmarshal(crudo, &sobre); err != nil {
		return false, status.Errorf(codes.Internal, "respuesta de Auth ilegible: %v", err)
	}

	permitido := sobre.Body.Respuesta.Success
	cacheAccesos.mu.Lock()
	if len(cacheAccesos.m) > 1000 {
		cacheAccesos.m = map[string]entradaAcceso{}
	}
	cacheAccesos.m[clave] = entradaAcceso{permitido: permitido, vence: time.Now().Add(time.Minute)}
	cacheAccesos.mu.Unlock()
	return permitido, nil
}

// exigirServicio aplica el mapa de servicios si el validador sabe hacerlo.
func exigirServicio(ctx context.Context, v Validator, u Usuario, servicio string) error {
	a, ok := v.(Autorizador)
	if !ok || servicio == "" {
		return nil
	}
	permitido, err := a.AutorizarServicio(ctx, u.UID, servicio)
	if err != nil {
		return err
	}
	if !permitido {
		return status.Errorf(codes.PermissionDenied, "tu perfil no tiene acceso al servicio %q", servicio)
	}
	return nil
}
