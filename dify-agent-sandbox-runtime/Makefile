.PHONY: build clean test lint integration integration-up integration-test integration-down
BIN_DIR := bin

build: $(BIN_DIR)/shellctl $(BIN_DIR)/shellctl-sanitize-pty $(BIN_DIR)/shellctl-runner-exit

$(BIN_DIR)/shellctl: $(shell find cmd/shellctl internal -name '*.go')
	go build -o $@ ./cmd/shellctl

$(BIN_DIR)/shellctl-sanitize-pty: $(shell find cmd/sanitize-pty internal/sanitize -name '*.go')
	go build -o $@ ./cmd/sanitize-pty

$(BIN_DIR)/shellctl-runner-exit: $(shell find cmd/runner-exit internal/runner_exit -name '*.go')
	go build -o $@ ./cmd/runner-exit

test: lint
	go test ./...

lint:
	golangci-lint run ./...

clean:
	rm -rf $(BIN_DIR)

# --- Integration tests ---

IMAGE_NAME := dify-agent-sandbox-runtime:test
CONTAINER_NAME := sandbox-runtime-test
HOST_PORT := 15005

integration-up:
	@echo "Building runtime image..."
	docker build -t $(IMAGE_NAME) -f docker/Dockerfile .
	@echo "Starting runtime container..."
	docker run -d --name $(CONTAINER_NAME) \
		-p $(HOST_PORT):5004 \
		-e SHELLCTL_AUTH_TOKEN=test-token-123 \
		$(IMAGE_NAME)
	@echo "Waiting for runtime to be ready..."
	@for i in $$(seq 1 30); do \
		if curl -sf http://localhost:$(HOST_PORT)/healthz > /dev/null 2>&1; then \
			echo "Runtime is ready"; \
			break; \
		fi; \
		if [ "$$i" -eq 30 ]; then \
			echo "ERROR: runtime not ready after 60s" >&2; \
			docker logs $(CONTAINER_NAME); \
			exit 1; \
		fi; \
		sleep 2; \
	done

integration-test: integration-up
	SHELLCTL_GO_URL=http://localhost:$(HOST_PORT) \
	SHELLCTL_TEST_TOKEN=test-token-123 \
	go test -tags=integration -v -count=1 -timeout=300s ./tests/...

integration-down:
	-docker rm -f $(CONTAINER_NAME)

integration: integration-up integration-test integration-down
