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

IMAGE_NAME := dify-agent-sandbox-runtime:test
TEST_ID := $(shell printf '%05d' $$((RANDOM % 100000)))
CONTAINER_NAME := sandbox-rt-$(TEST_ID)
HOST_PORT := $(shell python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()')
AUTH_TOKEN := test-token-$(TEST_ID)

integration-up:
	@echo "Building runtime image..."
	docker build -t $(IMAGE_NAME) -f docker/Dockerfile .
	@echo "Starting runtime container $(CONTAINER_NAME) on port $(HOST_PORT)..."
	docker run -d --name $(CONTAINER_NAME) \
		-p $(HOST_PORT):5004 \
		-e SHELLCTL_AUTH_TOKEN=$(AUTH_TOKEN) \
		$(IMAGE_NAME)
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
			exit 1; \
		fi; \
		sleep 2; \
	done

integration-test: integration-up
	@trap 'docker rm -f $(CONTAINER_NAME) 2>/dev/null' EXIT; \
	SHELLCTL_GO_URL=http://localhost:$(HOST_PORT) \
	SHELLCTL_TEST_TOKEN=$(AUTH_TOKEN) \
	go test -tags=integration -v -count=1 -timeout=300s ./tests/...

integration-down:
	-docker rm -f $(CONTAINER_NAME)

integration:
	@$(MAKE) integration-test
