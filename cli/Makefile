# Difyctl
#
# `make help` lists everything.
#
# Usage examples:
#   make install                       # install dependencies
#   make build                         # production bundle (dist/) + manifest
#   pnpm dev run app id "hi"           # run the CLI from source (use pnpm, not make)
#   make test                          # vitest
#   make ci                            # full CI pipeline
#   make release VERSION=1.2.3         # multi-platform tarballs
#   make version                       # print resolved buildinfo
#   make clean                         # delete build artifacts


PNPM ?= pnpm

.PHONY: help install build test coverage lint fix typecheck manifest version ci release clean sync-models

help: ## Show this help.
	@awk 'BEGIN{FS = ":.*## "; printf "Targets:\n"} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies (pnpm install).
	@$(PNPM) install

build: ## Production bundle into dist/ + oclif manifest.
	@$(PNPM) build

test: ## Run unit + integration tests (vitest).
	@$(PNPM) test

coverage: ## Run tests with coverage report.
	@$(PNPM) test:coverage

lint: ## Lint without auto-fix.
	@$(PNPM) lint

fix: ## Lint with auto-fix.
	@$(PNPM) lint:fix

typecheck: ## TypeScript type-check (no emit).
	@$(PNPM) type-check

manifest: ## Regenerate oclif command manifest.
	@$(PNPM) manifest

version: ## Print resolved buildinfo (what a build would inject).
	@$(PNPM) exec tsx scripts/print-buildinfo.ts

ci: typecheck lint coverage build ## Full CI pipeline (typecheck, lint, coverage, build).

release: ## Multi-platform tarballs. Reads channel/version from cli/package.json.
	@scripts/release.sh

clean: ## Remove build artifacts.
	@rm -rf dist oclif.manifest.json node_modules/.cache

sync-models: ## Regenerate TS models from API swagger spec.
	@echo "→ Generating openapi swagger spec…"
	cd ../api && uv run --project . dev/generate_swagger_specs.py
	@echo "→ Converting Swagger 2.0 → OpenAPI 3.x…"
	npx swagger2openapi ../api/openapi/openapi-swagger.json -o /tmp/openapi-oas3.json --patch
	@echo "→ Generating Zod schemas + TS types…"
	npx openapi-zod-client /tmp/openapi-oas3.json -o src/types/openapi-schemas.ts -t scripts/schemas-only.hbs --export-schemas
	sed -i.bak 's/z\.record(z\.string())/z.record(z.string(), z.string())/g' src/types/openapi-schemas.ts
	sed -i.bak 's/\.passthrough()/.loose()/g' src/types/openapi-schemas.ts
	sed -i.bak 's/z\.object({})\.partial()/z.record(z.string(), z.any())/g' src/types/openapi-schemas.ts
	sed -i.bak 's/z\.unknown()/z.null()/g' src/types/openapi-schemas.ts
	sed -i.bak 's/\.loose()//g' src/types/openapi-schemas.ts
	sed -i.bak 's/\.partial()//g' src/types/openapi-schemas.ts
	@rm -f src/types/openapi-schemas.ts.bak
	@echo "→ Fixing lint style…"
	@$(PNPM) lint:fix src/types/openapi-schemas.ts
	@rm -f /tmp/openapi-oas3.json
	@rm -f ../api/openapi/*-swagger.json
	@echo "✓ src/types/openapi-schemas.ts updated"

.DEFAULT_GOAL := help
