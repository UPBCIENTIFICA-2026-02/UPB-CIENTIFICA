// Package config carga la configuracion de syncd (node-sync) desde variables
// de entorno y banderas de linea de comandos.
package config

import (
	"flag"
	"os"
)

type Config struct {
	Addr    string // direccion de escucha, host:port
	DataDir string // raiz de los Home (montaje NFS /srv/home en produccion)
	TLSCert string // ruta al certificado TLS (PEM)
	TLSKey  string // ruta a la llave privada TLS (PEM)
}

func Load() Config {
	c := Config{
		Addr:    env("SYNC_ADDR", ":50051"),
		DataDir: env("SYNC_DATA_DIR", "/srv/home"),
		TLSCert: env("SYNC_TLS_CERT", ""),
		TLSKey:  env("SYNC_TLS_KEY", ""),
	}
	flag.StringVar(&c.Addr, "addr", c.Addr, "direccion de escucha host:port")
	flag.StringVar(&c.DataDir, "data", c.DataDir, "raiz de los Home (NFS /srv/home en produccion; use ./data en local)")
	flag.StringVar(&c.TLSCert, "tls-cert", c.TLSCert, "ruta al certificado TLS (PEM)")
	flag.StringVar(&c.TLSKey, "tls-key", c.TLSKey, "ruta a la llave privada TLS (PEM)")
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
