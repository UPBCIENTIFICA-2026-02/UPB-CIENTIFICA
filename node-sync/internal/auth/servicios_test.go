package auth

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Un node-soap de mentira: solo "investigador" tiene filesync.
func soapFalso(t *testing.T, llamadas *int) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*llamadas++
		b, _ := io.ReadAll(r.Body)
		ok := strings.Contains(string(b), "<usuario>investigador</usuario>") && strings.Contains(string(b), "<servicio>filesync</servicio>")
		if !strings.Contains(r.Header.Get("SOAPAction"), "validarAccesoServicio") {
			t.Errorf("SOAPAction inesperada: %s", r.Header.Get("SOAPAction"))
		}
		resp := "false"
		if ok {
			resp = "true"
		}
		_, _ = w.Write([]byte(`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body>` +
			`<ns1:validarAccesoServicioResponse><success>` + resp + `</success><message>x</message></ns1:validarAccesoServicioResponse>` +
			`</SOAP-ENV:Body></SOAP-ENV:Envelope>`))
	}))
}

func TestExigirServicio(t *testing.T) {
	llamadas := 0
	srv := soapFalso(t, &llamadas)
	defer srv.Close()
	v, err := NewSOAPValidator(srv.URL, "http://192.168.1.195/soap", "", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	if err := exigirServicio(ctx, v, Usuario{UID: "investigador"}, "filesync"); err != nil {
		t.Fatalf("investigador deberia tener filesync: %v", err)
	}
	err = exigirServicio(ctx, v, Usuario{UID: "estudiante"}, "filesync")
	if status.Code(err) != codes.PermissionDenied {
		t.Fatalf("estudiante: se esperaba PermissionDenied, llego %v", err)
	}
	// Cacheado: repetir no vuelve a llamar a Auth.
	antes := llamadas
	_ = exigirServicio(ctx, v, Usuario{UID: "investigador"}, "filesync")
	if llamadas != antes {
		t.Errorf("no uso la cache (%d -> %d llamadas)", antes, llamadas)
	}
	// Simulado: sin directorio, todo permitido.
	if err := exigirServicio(ctx, MockValidator{}, Usuario{UID: "estudiante"}, "filesync"); err != nil {
		t.Errorf("modo simulado no deberia restringir: %v", err)
	}
	// Auth caido: Unavailable, nunca permitido por defecto.
	srv.Close()
	cacheAccesos.m = map[string]entradaAcceso{}
	if err := exigirServicio(ctx, v, Usuario{UID: "investigador"}, "filesync"); status.Code(err) != codes.Unavailable {
		t.Errorf("Auth caido: se esperaba Unavailable, llego %v", err)
	}
}
