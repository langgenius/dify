# Docker deployment

Run Dify with Docker Compose. Configuration templates live in `.env.example` and `envs/`; local overrides belong in `.env`.

## How to Deploy Dify with `docker-compose.yaml`

1. **Prerequisites**: Ensure Docker and Docker Compose v2.24.0 or later are installed on your system.
2. **Environment Setup**:
   - Navigate to the `docker` directory.
   - Copy `.env.example` to `.env`.
   - Customize `.env` when you need to change essential startup defaults. Copy optional files from `envs/` without the `.example` suffix when you need advanced settings.
   - **Optional (for advanced deployments)**:
     If you maintain a full `.env` file copied from `.env.example`, you may use the environment synchronization tool to keep it aligned with the latest `.env.example` updates while retaining existing values for variables that remain in the template.
     See the [Environment Variables Synchronization](#environment-variables-synchronization) section below.
3. **Running the Services**:
   - Execute `docker compose up -d` from the `docker` directory to start the services.
   - To specify a vector database, set the `VECTOR_STORE` variable in your `.env` file to your desired vector database service, such as `milvus`, `weaviate`, or `opensearch`. See `envs/vectorstores/` for the full list of supported options.
   ```bash
   cp .env.example .env
   docker compose up -d
   ```

4. **SSL Certificate Setup**:
   - Refer to [the Certbot guide](certbot/README.md) to set up SSL certificates using Certbot.
5. **OpenTelemetry Collector Setup**:
   - Copy `envs/core-services/shared.env.example` to `envs/core-services/shared.env`.
   - Set `ENABLE_OTEL=true` and configure `OTLP_BASE_ENDPOINT`. Tune the other `OTEL_*` knobs in the same file if needed.

## How to Deploy Middleware for Developing Dify

1. **Middleware Setup**:
   - Use the `docker-compose.middleware.yaml` for setting up essential middleware services like databases and caches.
   - Navigate to the `docker` directory.
   - Ensure the `middleware.env` file is created by running `cp envs/middleware.env.example middleware.env` (refer to the `envs/middleware.env.example` file).
2. **Running Middleware Services**:
   - Navigate to the `docker` directory.
   - Execute `docker compose --env-file middleware.env -f docker-compose.middleware.yaml -p dify up -d` to start PostgreSQL/MySQL (per `DB_TYPE`) plus the bundled Weaviate instance.

> Compose automatically loads `COMPOSE_PROFILES=${DB_TYPE:-postgresql},weaviate` from `middleware.env`, so no extra `--profile` flags are needed. Adjust variables in `middleware.env` if you want a different combination of services.

## Overview of `.env`, `.env.example`, and `envs/`

- `.env.example` contains the essential default configuration for Docker Compose deployments.
- `.env` contains local startup values copied from `.env.example` and any local changes.
- `envs/*.env.example` files contain optional advanced configuration grouped by theme.

Keep the root `.env.example` limited to variables required to start the default Docker Compose deployment.
Do not add optional, advanced, provider-specific, or service-specific variables there; place them in the appropriate `envs/*.env.example` file instead.

Docker Compose reads `envs/*.env` files when present, then reads `.env` last so values in `.env` take precedence.

For the available variables and defaults, read the matching `envs/**/*.env.example` template and its service in `docker-compose.yaml`.

## Environment Variables Synchronization

When upgrading Dify or pulling the latest changes, new environment variables may be introduced in `.env.example` only when they are required for startup,
or in the optional files under `envs/` for advanced, provider-specific, and service-specific settings.

If you use the default workflow, review `.env.example` and keep your `.env` aligned with essential startup values.

If you maintain a customized `.env` file copied from `.env.example`, an optional environment variables synchronization tool is provided.

> This tool performs a **one-way synchronization** from `.env.example` to `.env`.
> Existing values are retained only for variables that remain in `.env.example`.
> Variables absent from the template are omitted from the rewritten `.env` and remain available in the backup.

### `dify-env-sync.sh` (Optional)

This script compares your current `.env` file with the latest `.env.example` template and helps safely apply new or updated environment variables.

**What it does**

- Creates a backup of the current `.env` file before making any changes
- Rebuilds `.env` using the comments, ordering, and variables from `.env.example`
- Preserves existing values for variables that remain in `.env.example`
- Adds newly introduced variables with their `.env.example` defaults
- Reports and omits variables that are absent from `.env.example`

**Backup behavior**

Before synchronization, the current `.env` file is saved to the `env-backup/` directory with a timestamped filename
(e.g. `env-backup/.env.backup_20231218_143022`).
Use this backup to recover custom comments, ordering, or variables that are not present in `.env.example`.

**When to use**

- After upgrading Dify to a newer version with a full `.env` file
- When `.env.example` has been updated with new environment variables
- When managing a large or heavily customized `.env` file copied from `.env.example`

**Usage**

```bash
# Grant execution permission (first time only)
chmod +x dify-env-sync.sh

# Run the synchronization
./dify-env-sync.sh
```
