SHELL := /bin/bash
.DEFAULT_GOAL := help

PROD_COMPOSE := ENV_FILE=.env.prod docker compose --env-file .env.prod -p sendme-prod

.PHONY: help init init-prod dev infra-up infra-down up down logs ps build api web admin-cli prod-up prod-down prod-logs prod-ps prod-admin-cli check fmt test clean

help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

init: ## Create .env from the example and generate fresh secrets
	@if [ -f .env ]; then echo ".env already exists; leaving it untouched."; exit 1; fi
	cp .env.example .env
	@JWT=$$(openssl rand -base64 48 | tr -d '\n'); \
	KEY=$$(openssl rand -base64 32 | tr -d '\n'); \
	SIG=$$(openssl rand -base64 32 | tr -d '\n'); \
	perl -pi -e "s|^JWT_SECRET=.*|JWT_SECRET=$$JWT|; s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$$KEY|; s|^SIGNING_SECRET=.*|SIGNING_SECRET=$$SIG|" .env
	@echo "Created .env with generated secrets. Review APP_URL and COOKIE settings before deploying."

init-prod: ## Create .env.prod with production settings and fresh secrets
	@test -n "$(APP_URL)" || { echo "Usage: make init-prod APP_URL=https://mail.example.com"; exit 1; }
	@case "$(APP_URL)" in https://*) ;; *) echo "APP_URL must use https:// in production"; exit 1;; esac
	@if [ -f .env.prod ]; then echo ".env.prod already exists; leaving it untouched."; exit 1; fi
	@set -e; umask 077; cp .env.example .env.prod; \
	JWT=$$(openssl rand -base64 48 | tr -d '\n'); \
	KEY=$$(openssl rand -base64 32 | tr -d '\n'); \
	SIG=$$(openssl rand -base64 32 | tr -d '\n'); \
	PG=$$(openssl rand -hex 24); \
	URL="$(APP_URL)"; URL="$${URL%/}"; \
	perl -pi -e "s|^APP_ENV=.*|APP_ENV=production|; s|^APP_URL=.*|APP_URL=$$URL|; s|^JWT_SECRET=.*|JWT_SECRET=$$JWT|; s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$$KEY|; s|^SIGNING_SECRET=.*|SIGNING_SECRET=$$SIG|; s|^COOKIE_SECURE=.*|COOKIE_SECURE=true|; s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$PG|; s|^ENV_FILE=.*|ENV_FILE=.env.prod|; s|^COMPOSE_PROJECT_NAME=.*|COMPOSE_PROJECT_NAME=sendme-prod|" .env.prod; \
	chmod 600 .env.prod; \
	echo "Created .env.prod with fresh production secrets."; \
	echo "  APP_URL: $$URL"; \
	echo "  Review MAIL_HELO_HOST, MAIL_PUBLIC_IP, and port mappings, then run: make prod-up"

prod-up: ## Build and start the production stack from .env.prod
	@test -f .env.prod || { echo ".env.prod not found. Run: make init-prod APP_URL=https://mail.example.com"; exit 1; }
	$(PROD_COMPOSE) up -d --build

prod-down: ## Stop the production stack
	$(PROD_COMPOSE) down

prod-logs: ## Follow production API and web logs
	$(PROD_COMPOSE) logs -f server web

prod-ps: ## Show production container status
	$(PROD_COMPOSE) ps

prod-admin-cli: ## Run admin-cli in the production stack (ARGS="...")
	$(PROD_COMPOSE) exec server admin-cli $(ARGS)

dev: ## Run the API and Next.js dev server together
	@set -a; [ -f .env ] && . ./.env; set +a; \
	export NEXT_PUBLIC_APP_URL="$${APP_URL:-http://localhost:3000}"; \
	(cd server && exec go run ./cmd/server) & api=$$!; \
	(cd web && exec npm run dev) & web=$$!; \
	trap 'kill $$api $$web 2>/dev/null' EXIT INT TERM; \
	wait

infra-up: ## Start Postgres and Redis with Docker Compose
	docker compose up -d postgres redis

infra-down: ## Stop Postgres and Redis
	docker compose stop postgres redis

up: ## Build and start the full stack with Docker Compose
	docker compose up -d --build

down: ## Stop the full stack
	docker compose down

logs: ## Follow application logs
	docker compose logs -f server web

ps: ## Show container status
	docker compose ps

build: ## Build the Go binaries and the Next.js production bundle
	cd server && go build -o bin/sendme ./cmd/server
	cd server && go build -o bin/admin-cli ./cmd/admin-cli
	@set -a; [ -f .env ] && . ./.env; set +a; \
	export NEXT_PUBLIC_APP_URL="$${APP_URL:-http://localhost:3000}"; \
	cd web && npm run build

api: ## Run the Go API with the worker enabled
	cd server && go run ./cmd/server

web: ## Run the Next.js dev server
	@set -a; [ -f .env ] && . ./.env; set +a; \
	export NEXT_PUBLIC_APP_URL="$${APP_URL:-http://localhost:3000}"; \
	cd web && npm run dev

admin-cli: ## Run the admin CLI (ARGS="create-admin --email ...")
	cd server && go run ./cmd/admin-cli $(ARGS)

check: fmt test ## Run formatting, vet, lint and type checks
	@test -z "$$(gofmt -l server)" || { echo "Go files need formatting:"; gofmt -l server; exit 1; }
	cd server && go vet ./...
	cd web && npm run lint && npx tsc --noEmit

fmt: ## Format Go source
	gofmt -w server

test: ## Run backend tests
	cd server && go test ./...

clean: ## Remove local build artifacts
	rm -rf server/bin web/.next
