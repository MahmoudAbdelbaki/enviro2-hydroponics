# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/hydro ./cmd/hydro && \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/hydro-mcp ./cmd/hydro-mcp

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata && \
    adduser -D -u 10001 hydro
USER hydro
WORKDIR /app

COPY --from=builder /out/hydro /usr/local/bin/hydro
COPY --from=builder /out/hydro-mcp /usr/local/bin/hydro-mcp
COPY --from=builder /src/schema /app/schema
COPY --from=builder /src/testdata /app/testdata
COPY --from=builder /src/openapi.yaml /app/openapi.yaml

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/hydro"]
