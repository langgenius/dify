.PHONY: build clean test lint proto gen-cli-help integration integration-up integration-test integration-down
BIN_DIR := bin
PROTO_SRC := ../dify-agent/proto/dify/agent/stub/v1/agent_stub.proto
PROTO_OUT := gen
AGENT_CLI_HELP_JSON := ../dify-agent/src/dify_agent/layers/_agent_cli_help.json

build: $(BIN_DIR)/shellctl $(BIN_DIR)/shellctl-sanitize-pty $(BIN_DIR)/shellctl-runner-exit $(BIN_DIR)/shellctl-runner $(BIN_DIR)/dify-agent gen-cli-help

$(BIN_DIR)/shellctl: $(shell find cmd/shellctl internal -name '*.go')
	go build -o $@ ./cmd/shellctl

$(BIN_DIR)/shellctl-sanitize-pty: $(shell find cmd/sanitize-pty internal/sanitize -name '*.go')
	go build -o $@ ./cmd/sanitize-pty

$(BIN_DIR)/shellctl-runner-exit: $(shell find cmd/runner-exit internal/runner_exit -name '*.go')
	go build -o $@ ./cmd/runner-exit

$(BIN_DIR)/shellctl-runner: $(shell find cmd/runner internal/landlock internal/cmdutil -name '*.go')
	go build -o $@ ./cmd/runner


$(BIN_DIR)/dify-agent: $(shell find cmd/dify-agent-cli internal/agentcli internal/stubclient -name '*.go') $(shell find gen -name '*.go' 2>/dev/null)
	go build -o $@ ./cmd/dify-agent-cli

# Regenerate the JSON help snapshot from the Go command tree. Runs as part of
# `build` so the checked-in data never drifts from the CLI.
gen-cli-help: $(BIN_DIR)/dify-agent
	$(BIN_DIR)/dify-agent __dump-cli-help > $(AGENT_CLI_HELP_JSON)

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
	$(eval CONTAINER_NAME_NOISO := sandbox-rt-noiso-$(TEST_ID))
	$(eval HOST_PORT_NOISO := $(shell python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()'))
	$(eval AUTH_TOKEN_NOISO := test-token-noiso-$(TEST_ID))
	@echo "Starting no-isolation container $(CONTAINER_NAME_NOISO) on port $(HOST_PORT_NOISO)..."
	docker run -d --name $(CONTAINER_NAME_NOISO) \
		-p $(HOST_PORT_NOISO):5004 \
		-e SHELLCTL_AUTH_TOKEN=$(AUTH_TOKEN_NOISO) \
		-e SHELLCTL_ENABLE_PATH_ISOLATION=false \
		$(IMAGE_NAME)
	@echo 'CONTAINER_NAME_NOISO=$(CONTAINER_NAME_NOISO)' >> $(STATE_FILE)
	@echo 'HOST_PORT_NOISO=$(HOST_PORT_NOISO)' >> $(STATE_FILE)
	@echo 'AUTH_TOKEN_NOISO=$(AUTH_TOKEN_NOISO)' >> $(STATE_FILE)
	@for i in $$(seq 1 30); do \
		if curl -sf http://localhost:$(HOST_PORT_NOISO)/healthz > /dev/null 2>&1; then \
			echo "No-isolation runtime is ready on port $(HOST_PORT_NOISO)"; \
			break; \
		fi; \
		if [ "$$i" -eq 30 ]; then \
			echo "ERROR: no-isolation runtime not ready after 60s" >&2; \
			docker logs $(CONTAINER_NAME_NOISO); \
			docker rm -f $(CONTAINER_NAME_NOISO) 2>/dev/null; \
			exit 1; \
		fi; \
		sleep 2; \
	done
	@echo "Setting up egress proxy container + echo backend..."
	$(eval EGRESS_NET := sandbox-rt-egress-net-$(TEST_ID))
	docker network create $(EGRESS_NET) > /dev/null
	$(eval ECHO_CONTAINER := echo-backend-$(TEST_ID))
	docker run -d --name $(ECHO_CONTAINER) \
		--network $(EGRESS_NET) --network-alias echo-backend \
		mendhak/http-https-echo:31
	$(eval EGRESS_CONTAINER_NAME := sandbox-rt-egress-$(TEST_ID))
	$(eval EGRESS_HOST_PORT := $(shell python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()'))
	$(eval EGRESS_AUTH_TOKEN := test-token-egress-$(TEST_ID))
	docker run -d --name $(EGRESS_CONTAINER_NAME) \
		--network $(EGRESS_NET) \
		-p $(EGRESS_HOST_PORT):5004 \
		-e SHELLCTL_AUTH_TOKEN=$(EGRESS_AUTH_TOKEN) \
		-e SHELLCTL_EGRESSPROXY_ENABLED=true \
		-e HTTP_PROXY=http://127.0.0.1:18080 \
		-e HTTPS_PROXY=http://127.0.0.1:18080 \
		-e NO_PROXY=localhost,127.0.0.1 \
		$(IMAGE_NAME)
	@echo 'EGRESS_NET=$(EGRESS_NET)' >> $(STATE_FILE)
	@echo 'ECHO_CONTAINER=$(ECHO_CONTAINER)' >> $(STATE_FILE)
	@echo 'EGRESS_CONTAINER_NAME=$(EGRESS_CONTAINER_NAME)' >> $(STATE_FILE)
	@echo 'EGRESS_HOST_PORT=$(EGRESS_HOST_PORT)' >> $(STATE_FILE)
	@echo 'EGRESS_AUTH_TOKEN=$(EGRESS_AUTH_TOKEN)' >> $(STATE_FILE)
	@for i in $$(seq 1 30); do \
		if curl -sf http://localhost:$(EGRESS_HOST_PORT)/healthz > /dev/null 2>&1; then \
			echo "Egress proxy runtime is ready on port $(EGRESS_HOST_PORT)"; \
			break; \
		fi; \
		if [ "$$i" -eq 30 ]; then \
			echo "ERROR: egress proxy runtime not ready after 60s" >&2; \
			docker logs $(EGRESS_CONTAINER_NAME); \
			docker rm -f $(EGRESS_CONTAINER_NAME) $(ECHO_CONTAINER) 2>/dev/null; \
			docker network rm $(EGRESS_NET) 2>/dev/null; \
			exit 1; \
		fi; \
		sleep 2; \
	done
	@echo "Setting up upstream squid + egress-proxy-with-upstream container..."
	@echo "  NOTE: an earlier iteration tried to place this runtime container on"
	@echo "  a network with no direct path to echo-backend (only reachable via"
	@echo "  squid-upstream bridging two networks), to force a true end-to-end"
	@echo "  regression test of hostname passthrough mirroring production's"
	@echo "  local_sandbox/agent_ssrf_proxy/api topology. That approach was"
	@echo "  reverted: multi-homing squid-upstream across two docker networks"
	@echo "  via 'docker network connect' hit a Docker/host networking pitfall"
	@echo "  (squid answered fine on its primary network but not the secondary"
	@echo "  one -- asymmetric routing / rp_filter in the Docker Desktop VM),"
	@echo "  which is an environment limitation unrelated to the proxy code."
	@echo "  Hostname-passthrough itself is covered reliably (no Docker network"
	@echo "  involved) by TestProxyUpstreamChainingPreservesHostname in"
	@echo "  internal/egressproxy/proxy_test.go. This test only verifies that"
	@echo "  upstream chaining + credential injection work end-to-end."
	$(eval SQUID_CONTAINER := squid-upstream-$(TEST_ID))
	docker run -d --name $(SQUID_CONTAINER) \
		--network $(EGRESS_NET) --network-alias squid-upstream \
		-v $(CURDIR)/tests/squid-test.conf:/etc/squid/squid.conf:ro \
		ubuntu/squid:latest
	$(eval EGRESS_UPSTREAM_CONTAINER_NAME := sandbox-rt-egress-upstream-$(TEST_ID))
	$(eval EGRESS_UPSTREAM_HOST_PORT := $(shell python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()'))
	$(eval EGRESS_UPSTREAM_AUTH_TOKEN := test-token-egress-upstream-$(TEST_ID))
	docker run -d --name $(EGRESS_UPSTREAM_CONTAINER_NAME) \
		--network $(EGRESS_NET) \
		-p $(EGRESS_UPSTREAM_HOST_PORT):5004 \
		-e SHELLCTL_AUTH_TOKEN=$(EGRESS_UPSTREAM_AUTH_TOKEN) \
		-e SHELLCTL_EGRESSPROXY_ENABLED=true \
		-e SHELLCTL_EGRESSPROXY_UPSTREAM=http://squid-upstream:3128 \
		-e HTTP_PROXY=http://127.0.0.1:18080 \
		-e HTTPS_PROXY=http://127.0.0.1:18080 \
		-e NO_PROXY=localhost,127.0.0.1 \
		$(IMAGE_NAME)
	@echo 'SQUID_CONTAINER=$(SQUID_CONTAINER)' >> $(STATE_FILE)
	@echo 'EGRESS_UPSTREAM_CONTAINER_NAME=$(EGRESS_UPSTREAM_CONTAINER_NAME)' >> $(STATE_FILE)
	@echo 'EGRESS_UPSTREAM_HOST_PORT=$(EGRESS_UPSTREAM_HOST_PORT)' >> $(STATE_FILE)
	@echo 'EGRESS_UPSTREAM_AUTH_TOKEN=$(EGRESS_UPSTREAM_AUTH_TOKEN)' >> $(STATE_FILE)
	@for i in $$(seq 1 30); do \
		if curl -sf http://localhost:$(EGRESS_UPSTREAM_HOST_PORT)/healthz > /dev/null 2>&1; then \
			echo "Egress-with-upstream runtime is ready on port $(EGRESS_UPSTREAM_HOST_PORT)"; \
			break; \
		fi; \
		if [ "$$i" -eq 30 ]; then \
			echo "ERROR: egress-with-upstream runtime not ready after 60s" >&2; \
			docker logs $(EGRESS_UPSTREAM_CONTAINER_NAME); \
			docker rm -f $(EGRESS_UPSTREAM_CONTAINER_NAME) $(SQUID_CONTAINER) 2>/dev/null; \
			exit 1; \
		fi; \
		sleep 2; \
	done

integration-test:
	@test -f $(STATE_FILE) || { echo "ERROR: run 'make integration-up' first" >&2; exit 1; }
	@. ./$(STATE_FILE); \
	SHELLCTL_GO_URL=http://localhost:$$HOST_PORT \
	SHELLCTL_TEST_TOKEN=$$AUTH_TOKEN \
	SHELLCTL_GO_URL_NO_ISOLATION=http://localhost:$$HOST_PORT_NOISO \
	SHELLCTL_TEST_TOKEN_NO_ISOLATION=$$AUTH_TOKEN_NOISO \
	SHELLCTL_EGRESS_GO_URL=http://localhost:$$EGRESS_HOST_PORT \
	SHELLCTL_EGRESS_TEST_TOKEN=$$EGRESS_AUTH_TOKEN \
	SHELLCTL_EGRESS_UPSTREAM_GO_URL=http://localhost:$$EGRESS_UPSTREAM_HOST_PORT \
	SHELLCTL_EGRESS_UPSTREAM_TEST_TOKEN=$$EGRESS_UPSTREAM_AUTH_TOKEN \
	go test -tags=integration -v -count=1 -timeout=300s ./tests/...

integration-logs:
	@test -f $(STATE_FILE) || { echo "ERROR: no state file" >&2; exit 1; }
	@. ./$(STATE_FILE); docker logs $$CONTAINER_NAME

integration-down:
	@if [ -f $(STATE_FILE) ]; then \
		. ./$(STATE_FILE); \
		docker rm -f $$CONTAINER_NAME 2>/dev/null || true; \
		docker rm -f $$CONTAINER_NAME_NOISO 2>/dev/null || true; \
		docker rm -f $$EGRESS_CONTAINER_NAME 2>/dev/null || true; \
		docker rm -f $$EGRESS_UPSTREAM_CONTAINER_NAME 2>/dev/null || true; \
		docker rm -f $$SQUID_CONTAINER 2>/dev/null || true; \
		docker rm -f $$ECHO_CONTAINER 2>/dev/null || true; \
		docker network rm $$EGRESS_NET 2>/dev/null || true; \
		rm -f $(STATE_FILE); \
	fi

integration:
	@$(MAKE) integration-up
	@trap '$(MAKE) integration-down' EXIT; \
	$(MAKE) integration-test
