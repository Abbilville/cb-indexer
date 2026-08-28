.PHONY: all build test clean docker-build docker-up

BINARY_NAME=oss-indexer

all: test build

build:
	go build -o bin/$(BINARY_NAME) ./cmd/oss-indexer

test:
	go test -v ./...

clean:
	rm -rf bin/

docker-build:
	docker build -t oss-indexer:latest .

docker-up:
	docker compose up -d
