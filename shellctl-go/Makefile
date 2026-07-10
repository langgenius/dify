.PHONY: build clean test lint integration-up integration-test integration-down integration

BIN_DIR := bin

build: $(BIN_DIR)/shellctl $(BIN_DIR)/shellctl-sanitize-pty $(BIN_DIR)/shellctl-runner-exit

$(BIN_DIR)/shellctl: $(shell find cmd/shellctl internal -name '*.go')
	go build -o $@ ./cmd/shellctl

$(BIN_DIR)/shellctl-sanitize-pty: $(shell find cmd/sanitize-pty internal/sanitize -name '*.go')
	go build -o $@ ./cmd/sanitize-pty

$(BIN_DIR)/shellctl-runner-exit: $(shell find cmd/runner-exit internal/runner_exit -name '*.go')
	go build -o $@ ./cmd/runner-exit

test:
	go test ./...

lint:
	golangci-lint run ./...

clean:
	rm -rf $(BIN_DIR)

# --- Integration tests (Docker) ---

integration-up:
	docker compose -f tests/docker-compose.yml up --build -d
	@echo "Waiting for services to be healthy..."
	@sleep 5

integration-test:
	go test -tags=integration -v -count=1 ./tests/...

integration-down:
	docker compose -f tests/docker-compose.yml down -v

# Full cycle: up → test → down
integration: integration-up integration-test integration-down
