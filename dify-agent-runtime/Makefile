.PHONY: build clean test lint gen-cli-help rust-build rust-test rust-lint integration integration-up integration-test integration-test-rollout integration-logs integration-down sync-e2b-template-dev sync-e2b-template-prod sync-e2b-template-dry-run
BIN_DIR := bin
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


$(BIN_DIR)/dify-agent: $(shell find cmd/dify-agent-cli internal/agentcli -name '*.go')
	go build -o $@ ./cmd/dify-agent-cli

# Regenerate the JSON help snapshot from the Go command tree. Runs as part of
# `build` so the checked-in data never drifts from the CLI.
gen-cli-help: $(BIN_DIR)/dify-agent
	$(BIN_DIR)/dify-agent __dump-cli-help > $(AGENT_CLI_HELP_JSON)

# --- Rust runtime ---
# The Rust implementation lives beside the Go implementation while the
# protocol and integration tests are migrated incrementally.
rust-build:
	cargo build --manifest-path rust/Cargo.toml --bins

rust-test:
	cargo test --manifest-path rust/Cargo.toml

rust-lint:
	cargo fmt --manifest-path rust/Cargo.toml --all -- --check
	cargo clippy --manifest-path rust/Cargo.toml --all-targets -- -D warnings

test: lint
	go test ./...

lint:
	golangci-lint run ./...

clean:
	rm -rf $(BIN_DIR)

# --- Integration tests ---
#
# Container names are randomised per invocation. Docker atomically assigns
# host ports, avoiding the bind-close-run race of probing a supposedly free
# port before starting each container.
#
# State is written to .integration-state so that separate make invocations
# (integration-up, integration-test, integration-logs, integration-down)
# can reference the same container. `make integration` runs the full
# lifecycle in a single invocation with automatic cleanup.

IMAGE_NAME := dify-agent-runtime:test
RUST_IMAGE_NAME := dify-agent-runtime-rust:test
STATE_FILE := .integration-state

integration-up:
	@echo "Building Go runtime image..."
	docker build -t $(IMAGE_NAME) -f docker/Dockerfile .
	@echo "Building Rust runtime image..."
	docker build -t $(RUST_IMAGE_NAME) -f docker/Dockerfile.rust .
	$(eval TEST_ID := $(shell python3 -c 'import secrets; print(secrets.token_hex(4))'))
	$(eval CONTAINER_NAME := sandbox-rt-$(TEST_ID))
	$(eval AUTH_TOKEN := test-token-$(TEST_ID))
	$(eval CONTAINER_NAME_RUST := sandbox-rt-rust-$(TEST_ID))
	$(eval CONTAINER_NAME_NOISO := sandbox-rt-noiso-$(TEST_ID))
	$(eval CONTAINER_NAME_RUST_NOISO := sandbox-rt-rust-noiso-$(TEST_ID))
	$(eval AUTH_TOKEN_NOISO := test-token-noiso-$(TEST_ID))
	@{ \
		echo 'CONTAINER_NAME=$(CONTAINER_NAME)'; \
		echo 'CONTAINER_NAME_RUST=$(CONTAINER_NAME_RUST)'; \
		echo 'CONTAINER_NAME_NOISO=$(CONTAINER_NAME_NOISO)'; \
		echo 'CONTAINER_NAME_RUST_NOISO=$(CONTAINER_NAME_RUST_NOISO)'; \
		echo 'AUTH_TOKEN=$(AUTH_TOKEN)'; \
		echo 'AUTH_TOKEN_NOISO=$(AUTH_TOKEN_NOISO)'; \
	} > $(STATE_FILE)
	@echo "Starting runtime container $(CONTAINER_NAME)..."
	docker run -d --name $(CONTAINER_NAME) \
		-p 127.0.0.1::5004 \
		-e SHELLCTL_AUTH_TOKEN=$(AUTH_TOKEN) \
		$(IMAGE_NAME)
	@HOST_PORT=$$(docker port $(CONTAINER_NAME) 5004/tcp | awk -F: 'NR == 1 { print $$NF }'); \
		test -n "$$HOST_PORT"; \
		echo "HOST_PORT=$$HOST_PORT" >> $(STATE_FILE); \
		echo "Waiting for runtime on port $$HOST_PORT..."; \
		for i in $$(seq 1 30); do \
		if curl -sf http://127.0.0.1:$$HOST_PORT/healthz > /dev/null 2>&1; then \
			echo "Runtime is ready on port $$HOST_PORT"; \
			break; \
		fi; \
		if [ "$$i" -eq 30 ]; then \
			echo "ERROR: runtime not ready after 60s" >&2; \
			docker logs $(CONTAINER_NAME); \
			exit 1; \
		fi; \
		sleep 2; \
	done
	@echo "Starting Rust runtime container $(CONTAINER_NAME_RUST)..."
	docker run -d --name $(CONTAINER_NAME_RUST) \
		-p 127.0.0.1::5004 \
		-e SHELLCTL_AUTH_TOKEN=$(AUTH_TOKEN) \
		$(RUST_IMAGE_NAME)
	@HOST_PORT_RUST=$$(docker port $(CONTAINER_NAME_RUST) 5004/tcp | awk -F: 'NR == 1 { print $$NF }'); \
		test -n "$$HOST_PORT_RUST"; \
		echo "HOST_PORT_RUST=$$HOST_PORT_RUST" >> $(STATE_FILE); \
		for i in $$(seq 1 30); do \
		if curl -sf http://127.0.0.1:$$HOST_PORT_RUST/healthz > /dev/null 2>&1; then \
			echo "Rust runtime is ready on port $$HOST_PORT_RUST"; \
			break; \
		fi; \
		if [ "$$i" -eq 30 ]; then \
			echo "ERROR: Rust runtime not ready after 60s" >&2; \
			docker logs $(CONTAINER_NAME_RUST); \
			exit 1; \
		fi; \
		sleep 2; \
	done
	@echo "Starting no-isolation container $(CONTAINER_NAME_NOISO)..."
	docker run -d --name $(CONTAINER_NAME_NOISO) \
		-p 127.0.0.1::5004 \
		-e SHELLCTL_AUTH_TOKEN=$(AUTH_TOKEN_NOISO) \
		-e SHELLCTL_ENABLE_PATH_ISOLATION=false \
		$(IMAGE_NAME)
	@HOST_PORT_NOISO=$$(docker port $(CONTAINER_NAME_NOISO) 5004/tcp | awk -F: 'NR == 1 { print $$NF }'); \
		test -n "$$HOST_PORT_NOISO"; \
		echo "HOST_PORT_NOISO=$$HOST_PORT_NOISO" >> $(STATE_FILE); \
		for i in $$(seq 1 30); do \
		if curl -sf http://127.0.0.1:$$HOST_PORT_NOISO/healthz > /dev/null 2>&1; then \
			echo "No-isolation runtime is ready on port $$HOST_PORT_NOISO"; \
			break; \
		fi; \
		if [ "$$i" -eq 30 ]; then \
			echo "ERROR: no-isolation runtime not ready after 60s" >&2; \
			docker logs $(CONTAINER_NAME_NOISO); \
			exit 1; \
		fi; \
		sleep 2; \
	done
	@echo "Starting Rust no-isolation container $(CONTAINER_NAME_RUST_NOISO)..."
	docker run -d --name $(CONTAINER_NAME_RUST_NOISO) \
		-p 127.0.0.1::5004 \
		-e SHELLCTL_AUTH_TOKEN=$(AUTH_TOKEN_NOISO) \
		-e SHELLCTL_ENABLE_PATH_ISOLATION=false \
		$(RUST_IMAGE_NAME)
	@HOST_PORT_RUST_NOISO=$$(docker port $(CONTAINER_NAME_RUST_NOISO) 5004/tcp | awk -F: 'NR == 1 { print $$NF }'); \
		test -n "$$HOST_PORT_RUST_NOISO"; \
		echo "HOST_PORT_RUST_NOISO=$$HOST_PORT_RUST_NOISO" >> $(STATE_FILE); \
		for i in $$(seq 1 30); do \
		if curl -sf http://127.0.0.1:$$HOST_PORT_RUST_NOISO/healthz > /dev/null 2>&1; then \
			echo "Rust no-isolation runtime is ready on port $$HOST_PORT_RUST_NOISO"; \
			break; \
		fi; \
		if [ "$$i" -eq 30 ]; then \
			echo "ERROR: Rust no-isolation runtime not ready after 60s" >&2; \
			docker logs $(CONTAINER_NAME_RUST_NOISO); \
			exit 1; \
		fi; \
		sleep 2; \
	done

integration-test:
	@test -f $(STATE_FILE) || { echo "ERROR: run 'make integration-up' first" >&2; exit 1; }
	@. ./$(STATE_FILE); \
	SHELLCTL_GO_URL=http://localhost:$$HOST_PORT \
	SHELLCTL_TEST_TOKEN=$$AUTH_TOKEN \
	SHELLCTL_RUST_URL=http://localhost:$$HOST_PORT_RUST \
	SHELLCTL_RUST_TEST_TOKEN=$$AUTH_TOKEN \
	SHELLCTL_RUST_IMAGE=$(RUST_IMAGE_NAME) \
	SHELLCTL_GO_URL_NO_ISOLATION=http://localhost:$$HOST_PORT_NOISO \
	SHELLCTL_TEST_TOKEN_NO_ISOLATION=$$AUTH_TOKEN_NOISO \
	SHELLCTL_RUST_URL_NO_ISOLATION=http://localhost:$$HOST_PORT_RUST_NOISO \
	SHELLCTL_RUST_TEST_TOKEN_NO_ISOLATION=$$AUTH_TOKEN_NOISO \
	go test -tags=integration -v -count=1 -timeout=300s ./tests/...

integration-test-rollout:
	@test -f $(STATE_FILE) || { echo "ERROR: run 'make integration-up' first" >&2; exit 1; }
	@. ./$(STATE_FILE); \
	NO_PROXY=127.0.0.1,localhost \
	PYTHONPATH=../dify-agent/src \
	DIFY_AGENT_TEST_LOCAL_SHELLCTL_ENDPOINT=http://127.0.0.1:$$HOST_PORT \
	DIFY_AGENT_TEST_LOCAL_SHELLCTL_AUTH_TOKEN=$$AUTH_TOKEN \
	DIFY_AGENT_TEST_RUST_SHELLCTL_ENDPOINT=http://127.0.0.1:$$HOST_PORT_RUST \
	DIFY_AGENT_TEST_RUST_SHELLCTL_AUTH_TOKEN=$$AUTH_TOKEN \
	uv run --project ../dify-agent --extra server pytest --import-mode=importlib -q \
		../dify-agent/tests/integration/dify_agent/runtime_backend/test_working_environment.py \
		-k 'local'

integration-logs:
	@test -f $(STATE_FILE) || { echo "ERROR: no state file" >&2; exit 1; }
	@. ./$(STATE_FILE); \
		docker logs $$CONTAINER_NAME; \
		docker logs $$CONTAINER_NAME_RUST; \
		docker logs $$CONTAINER_NAME_NOISO; \
		docker logs $$CONTAINER_NAME_RUST_NOISO

integration-down:
	@if [ -f $(STATE_FILE) ]; then \
		. ./$(STATE_FILE); \
		docker rm -f $$CONTAINER_NAME 2>/dev/null || true; \
		docker rm -f $$CONTAINER_NAME_RUST 2>/dev/null || true; \
		docker rm -f $$CONTAINER_NAME_NOISO 2>/dev/null || true; \
		docker rm -f $$CONTAINER_NAME_RUST_NOISO 2>/dev/null || true; \
		rm -f $(STATE_FILE); \
	fi

integration:
	@trap '$(MAKE) integration-down' EXIT INT TERM; \
	$(MAKE) integration-up && $(MAKE) integration-test && $(MAKE) integration-test-rollout

# --- E2B Template sync ---
#
# Both E2B projects publish the same template name (dify-agent-local-sandbox);
# the project itself is the isolation boundary. Export E2B_API_KEY_DEV /
# E2B_API_KEY_PROD in your shell before running the non-dry-run targets.

sync-e2b-template-dry-run:
	./docker/sync-e2b-template.sh --dry-run

sync-e2b-template-dev:
	E2B_API_KEY=$(E2B_API_KEY_DEV) ./docker/sync-e2b-template.sh

sync-e2b-template-prod:
	E2B_API_KEY=$(E2B_API_KEY_PROD) ./docker/sync-e2b-template.sh
