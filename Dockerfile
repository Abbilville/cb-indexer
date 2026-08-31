# Stage 1: Build binary
FROM golang:1.25-alpine AS builder

WORKDIR /app

RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/bin/oss-indexer ./cmd/oss-indexer

# Stage 2: Runtime image with Git and Node.js for codebase-memory-mcp
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git bash ca-certificates \
    && npm install -g codebase-memory-mcp@latest

COPY --from=builder /app/bin/oss-indexer /usr/local/bin/oss-indexer

ENV PORT=43770
ENV OSS_INDEXER_AUTH_TOKEN=""

EXPOSE 43770

ENTRYPOINT ["oss-indexer", "daemon", "--port", "43770"]
