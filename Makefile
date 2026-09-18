.PHONY: all build test clean docker-build docker-up build-web generate

BINARY_NAME=cb-indexer

all: test build

generate:
	go generate ./...

build-web:
	cd website && npm run build

build:
	go build -o bin/$(BINARY_NAME) ./cmd/cb-indexer
test:
	go test -v ./internal/... ./cmd/...

clean:
	rm -rf bin/

docker-build:
	docker build -t cb-indexer:latest .

docker-up:
	docker compose up -d
