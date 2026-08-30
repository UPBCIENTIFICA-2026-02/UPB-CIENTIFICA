BINARY := bin/syncd
PROTO  := proto/filesync/filesync.proto

.PHONY: all proto build run run-tls certs client tidy fmt clean

all: build

# Genera los stubs Go desde el .proto (requiere protoc + protoc-gen-go[-grpc])
proto:
	protoc --go_out=. --go_opt=paths=source_relative \
	       --go-grpc_out=. --go-grpc_opt=paths=source_relative $(PROTO)

# Compila el servidor syncd
build:
	go build -o $(BINARY) ./cmd/syncd

# Genera un certificado TLS autofirmado para desarrollo
certs:
	./scripts/gen-cert.sh certs

# Ejecuta en local SIN TLS (desarrollo). Home en ./data
run: build
	./$(BINARY) -data ./data

# Ejecuta en local CON TLS (usa certs/). Home en ./data
run-tls: build certs
	./$(BINARY) -data ./data -tls-cert certs/server.crt -tls-key certs/server.key

# Cliente de prueba de extremo a extremo
client:
	go run ./examples/client

# Descarga y ordena dependencias (requiere Internet)
tidy:
	go mod tidy

fmt:
	gofmt -w .

clean:
	rm -rf bin data client-data
