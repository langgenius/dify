.PHONY: build clean test lint proto integration integration-up integration-test integration-down
BIN_DIR := bin
PROTO_SRC := ../dify-agent/proto/dify/agent/stub/v1/agent_stub.proto
PROTO_OUT := gen

build: $(BIN_DIR)/shellctl $(BIN_DIR)/shellctl-sanitize-pty $(BIN_DIR)/shellctl-runner-exit $(BIN_DIR)/dify-agent

$(BIN_DIR)/shellctl: $(shell find cmd/shellctl internal -name '*.go')
	go build -o $@ ./cmd/shellctl

$(BIN_DIR)/shellctl-sanitize-pty: $(shell find cmd/sanitize-pty internal/sanitize -name '*.go')
	go build -o $@ ./cmd/sanitize-pty

$(BIN_DIR)/shellctl-runner-exit: $(shell find cmd/runner-exit internal/runner_exit -name '*.go')
	go build -o $@ ./cmd/runner-exit

$(BIN_DIR)/dify-agent: $(shell find cmd/dify-agent-cli internal/agentcli internal/stubclient -name '*.go') $(shell find gen -name '*.go' 2>/dev/null)
	go build -o $@ ./cmd/dify-agent-cli

test: lint
	go test ./...

lint:
	golangci-lint run ./...

proto:
	@mkdir -p $(PROTO_OUT)
	protoc \
		--proto_path=../dify-agent/proto \
		--go_out=$(PROTO_OUT) --go_opt=paths=source_relative \
		--go-grpc_out=$(PROTO_OUT) --go-grpc_opt=paths=source_relative \
		$(PROTO_SRC)

clean:
	rm -rf $(BIN_DIR)

# --- Integration tests ---
#
# Container name and host port are randomised per invocation to avoid
# conflicts when multiple runs overlap or a previous run leaked a container.
#
# State is written to .integration-state so that separate make invocations
# (integration-up, integration-test, integration-logs, integration-down)
# can reference the same container. `make integration` runs the full
# lifecycle in a single invocation with automatic cleanup.

IMAGE_NAME := dify-agent-runtime:test
STATE_FILE := .integration-state

integration-up:
	@echo "Building runtime image..."
	docker build -t $(IMAGE_NAME) -f docker/Dockerfile .
	$(eval TEST_ID := $(shell printf '%05d' $$((RANDOM % 100000))))
	$(eval CONTAINER_NAME := sandbox-rt-$(TEST_ID))
	$(eval HOST_PORT := $(shell python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()'))
	$(eval AUTH_TOKEN := test-token-$(TEST_ID))
	@echo "Starting runtime container $(CONTAINER_NAME) on port $(HOST_PORT)..."
	docker run -d --name $(CONTAINER_NAME) \
		-p $(HOST_PORT):5004 \
		-e SHELLCTL_AUTH_TOKEN=$(AUTH_TOKEN) \
		$(IMAGE_NAME)
	@echo 'CONTAINER_NAME=$(CONTAINER_NAME)' > $(STATE_FILE)
	@echo 'HOST_PORT=$(HOST_PORT)' >> $(STATE_FILE)
	@echo 'AUTH_TOKEN=$(AUTH_TOKEN)' >> $(STATE_FILE)
	@echo "Waiting for runtime to be ready..."
	@for i in $$(seq 1 30); do \
		if curl -sf http://localhost:$(HOST_PORT)/healthz > /dev/null 2>&1; then \
			echo "Runtime is ready on port $(HOST_PORT)"; \
			break; \
		fi; \
		if [ "$$i" -eq 30 ]; then \
			echo "ERROR: runtime not ready after 60s" >&2; \
			docker logs $(CONTAINER_NAME); \
			docker rm -f $(CONTAINER_NAME) 2>/dev/null; \
			rm -f $(STATE_FILE); \
			exit 1; \
		fi; \
		sleep 2; \
	done

integration-test:
	@test -f $(STATE_FILE) || { echo "ERROR: run 'make integration-up' first" >&2; exit 1; }
	@. ./$(STATE_FILE); \
	SHELLCTL_GO_URL=http://localhost:$$HOST_PORT \
	SHELLCTL_TEST_TOKEN=$$AUTH_TOKEN \
	go test -tags=integration -v -count=1 -timeout=300s ./tests/...

integration-logs:
	@test -f $(STATE_FILE) || { echo "ERROR: no state file" >&2; exit 1; }
	@. ./$(STATE_FILE); docker logs $$CONTAINER_NAME

integration-down:
	@if [ -f $(STATE_FILE) ]; then \
		. ./$(STATE_FILE); \
		docker rm -f $$CONTAINER_NAME 2>/dev/null || true; \
		rm -f $(STATE_FILE); \
	fi

integration:
	@$(MAKE) integration-up
	@trap '$(MAKE) integration-down' EXIT; \
	$(MAKE) integration-test
