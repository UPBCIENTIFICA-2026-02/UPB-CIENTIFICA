package dominio

import (
	"testing"
	"time"
)

func TestPlanificar(t *testing.T) {
	ahora := time.Date(2026, 10, 12, 17, 5, 0, 0, time.UTC)
	locales := []ArchivoLocal{
		{Ruta: "R/nuevo.txt", Hash: "a"},
		{Ruta: "R/igual.txt", Hash: "b", HashBase: "b"},
		{Ruta: "R/cambio-local.txt", Hash: "c2", HashBase: "c1"},
		{Ruta: "R/cambio-remoto.txt", Hash: "d1", HashBase: "d1"},
		{Ruta: "R/ambos.txt", Hash: "e2", HashBase: "e1"},
		{Ruta: "R/borrado-remoto.txt", Hash: "f", HashBase: "f"},
		{Ruta: "R/borrado-remoto-pero-editado.txt", Hash: "g2", HashBase: "g1"},
		{Ruta: "R/borrado-local.txt", HashBase: "h", Eliminado: true},
		{Ruta: "R/borrado-local-pero-editado-remoto.txt", HashBase: "i1", Eliminado: true},
		{Ruta: "R/borrado-ambos.txt", HashBase: "j", Eliminado: true},
		{Ruta: "R/primera-vez-distinto.txt", Hash: "k1"},
	}
	servidor := []ArchivoServidor{
		{Ruta: "R/igual.txt", Hash: "b"},
		{Ruta: "R/cambio-local.txt", Hash: "c1"},
		{Ruta: "R/cambio-remoto.txt", Hash: "d2"},
		{Ruta: "R/ambos.txt", Hash: "e3"},
		{Ruta: "R/borrado-local.txt", Hash: "h"},
		{Ruta: "R/borrado-local-pero-editado-remoto.txt", Hash: "i2"},
		{Ruta: "R/primera-vez-distinto.txt", Hash: "k2"},
		{Ruta: "R/solo-servidor.txt", Hash: "z"},
	}
	esperado := map[string]Accion{
		"R/nuevo.txt":                             Subir,
		"R/igual.txt":                             Igual,
		"R/cambio-local.txt":                      Subir,
		"R/cambio-remoto.txt":                     Bajar,
		"R/ambos.txt":                             Conflicto,
		"R/borrado-remoto.txt":                    Borrar,
		"R/borrado-remoto-pero-editado.txt":       Subir,
		"R/borrado-local.txt":                     BorrarServidor,
		"R/borrado-local-pero-editado-remoto.txt": Conflicto,
		"R/primera-vez-distinto.txt":              Conflicto,
		"R/solo-servidor.txt":                     Bajar,
	}
	got := Planificar(locales, servidor, "movil-ana", ahora)
	if len(got) != len(esperado) {
		t.Fatalf("decisiones: %d, esperadas %d: %+v", len(got), len(esperado), got)
	}
	for _, d := range got {
		if esperado[d.Ruta] != d.Accion {
			t.Errorf("%s: accion %d, esperada %d", d.Ruta, d.Accion, esperado[d.Ruta])
		}
		if d.Accion == Conflicto && d.RutaConflicto == "" {
			t.Errorf("%s: conflicto sin ruta de conflicto", d.Ruta)
		}
	}
}

func TestRutaConflicto(t *testing.T) {
	c := RutaConflicto("Docs/informe.pdf", "movil:ana", time.Date(2026, 10, 12, 17, 5, 0, 0, time.UTC))
	if c != "Docs/informe (conflicto - movil-ana - 2026-10-12 17.05).pdf" {
		t.Fatal(c)
	}
}

func TestNormalizarRuta(t *testing.T) {
	for _, mala := range []string{"", "/etc/passwd", "../x", "a/../../x", "a/.."} {
		if _, err := NormalizarRuta(mala); err == nil {
			t.Errorf("%q deberia rechazarse", mala)
		}
	}
	if r, _ := NormalizarRuta(`Fotos\2026\a.jpg`); r != "Fotos/2026/a.jpg" {
		t.Error(r)
	}
}
