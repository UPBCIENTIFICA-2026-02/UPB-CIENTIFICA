// Package config carga la configuracion de syncd (node-sync) desde variables
// de entorno y banderas de linea de comandos.
package config

import (
	"flag"
	"os"
	"time"
)

type Config struct {
	Addr    string // direccion de escucha, host:port
	DataDir string // raiz de los Home (montaje NFS /srv/home en produccion)
	TLSCert string // ruta al certificado TLS (PEM)
	TLSKey  string // ruta a la llave privada TLS (PEM)

	// --- Autenticacion contra node-soap ---
	AuthMode      string        // "simulado" | "soap"
	AuthURL       string        // endpoint del WSDL de node-soap
	AuthNamespace string        // targetNamespace del WSDL
	AuthCA        string        // CA propia que firma el HTTPS de node-soap (opcional)
	AuthCacheTTL  time.Duration // cuanto se cachea un token validado
}

func Load() Config {
	c := Config{
		Addr:    env("SYNC_ADDR", ":9090"),
		DataDir: env("SYNC_DATA_DIR", "/srv/home"),
		TLSCert: env("SYNC_TLS_CERT", ""),
		TLSKey:  env("SYNC_TLS_KEY", ""),

		AuthMode: env("SYNC_AUTH_MODE", "simulado"),
		// Endpoint y namespace REALES del WSDL de node-soap.
		AuthURL:       env("SYNC_AUTH_URL", "https://192.168.1.195:8081/soap/user.php"),
		AuthNamespace: env("SYNC_AUTH_NS", "http://192.168.1.195/soap"),
		AuthCA:        env("SYNC_AUTH_CA", ""),
		AuthCacheTTL:  5 * time.Second,
	}

	flag.StringVar(&c.Addr, "addr", c.Addr, "direccion de escucha host:port")
	flag.StringVar(&c.DataDir, "data", c.DataDir, "raiz de los Home (NFS /srv/home en produccion; use ./data en local)")
	flag.StringVar(&c.TLSCert, "tls-cert", c.TLSCert, "ruta al certificado TLS (PEM)")
	flag.StringVar(&c.TLSKey, "tls-key", c.TLSKey, "ruta a la llave privada TLS (PEM)")
	flag.StringVar(&c.AuthMode, "auth-mode", c.AuthMode, `validacion de token: "simulado" o "soap"`)
	flag.StringVar(&c.AuthURL, "auth-url", c.AuthURL, "endpoint SOAP de node-soap (user.php)")
	flag.StringVar(&c.AuthCA, "auth-ca", c.AuthCA, "CA que firma el HTTPS de node-soap (PEM); vacio = raices del sistema")
	flag.Parse()

	return c
}

// TLSEnabled indica si hay certificado y llave configurados.
func (c Config) TLSEnabled() bool { return c.TLSCert != "" && c.TLSKey != "" }

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
