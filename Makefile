.PHONY: build test race lint run run-mcp clean

build:
	go build -trimpath -o bin/hydro ./cmd/hydro
	go build -trimpath -o bin/hydro-mcp ./cmd/hydro-mcp

test:
	go test -v -race ./...

race:
	go test -race -count=1 ./...

lint:
	go vet ./...

run:
	go run ./cmd/hydro

run-mcp:
	go run ./cmd/hydro-mcp

clean:
	rm -rf bin/
