.PHONY: up down reset logs ps restart frontend-dev frontend-build build test race lint run run-mcp clean

up:
	docker compose up -d --build --wait
	@echo "Hydro stack is running:"
	@echo "  Frontend UI  : http://localhost:5173"
	@echo "  Backend API  : http://localhost:8080"
	@echo "  Read-only MCP: http://localhost:8080/mcp"

down:
	docker compose down

reset:
	docker compose down -v

logs:
	docker compose logs -f

ps:
	docker compose ps

restart:
	docker compose restart

frontend-dev:
	cd frontend && npm run dev

frontend-build:
	cd frontend && npm run build

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
