## README for docker Deployment

Welcome to the new `docker` directory for deploying Dify using Docker Compose. This README outlines the updates, deployment instructions, and migration details for existing users.

### What's Updated

- **Certbot Container**: `docker-compose.yaml` now contains `certbot` for managing SSL certificates. This container automatically renews certificates and ensures secure HTTPS connections.\
  For more information, refer `docker/certbot/README.md`.

- **Persistent Environment Variables**: Essential startup defaults are provided in `.env.example`, while local values are stored in `.env`, ensuring that your configurations persist across deployments.

  > What is `.env`? </br> </br>
  > The `.env` file is the local startup file. Copy it from `.env.example` for a default deployment. Optional advanced settings live in `envs/*.env.example` files.

- **Unified Vector Database Services**: All vector database services are now managed from a single Docker Compose file `docker-compose.yaml`. You can switch between different vector databases by setting the `VECTOR_STORE` environment variable in your `.env` file.

### How to Deploy Dify with `docker-compose.yaml`

1. **Prerequisites**: Ensure Docker and Docker Compose are installed on your system.
1. **Environment Setup**:
   - Navigate to the `docker` directory.
   - Copy `.env.example` to `.env`.
   - Customize `.env` when you need to change essential startup defaults. Copy optional files from `envs/` without the `.example` suffix when you need advanced settings.
   - **Optional (for advanced deployments)**:
     If you maintain a full `.env` file copied from `.env.example`, you may use the environment synchronization tool to keep it aligned with the latest `.env.example` updates while preserving your custom settings.
     See the [Environment Variables Synchronization](#environment-variables-synchronization) section below.
1. **Running the Services**:
   - Execute `docker compose up -d` from the `docker` directory to start the services.
   - To specify a vector database, set the `VECTOR_STORE` variable in your `.env` file to your desired vector database service, such as `milvus`, `weaviate`, or `opensearch`.
   ```bash
   cp .env.example .env
   docker compose up -d
   ```

1. **SSL Certificate Setup**:
   - Refer `docker/certbot/README.md` to set up SSL certificates using Certbot.
1. **OpenTelemetry Collector Setup**:
   - Change `ENABLE_OTEL` to `true` in `.env`.
   - Configure `OTLP_BASE_ENDPOINT` properly.

### How to Deploy Middleware for Developing Dify

1. **Middleware Setup**:
   - Use the `docker-compose.middleware.yaml` for setting up essential middleware services like databases and caches.
   - Navigate to the `docker` directory.
   - Ensure the `middleware.env` file is created by running `cp envs/middleware.env.example middleware.env` (refer to the `envs/middleware.env.example` file).
1. **Running Middleware Services**:
   - Navigate to the `docker` directory.
   - Execute `docker compose --env-file middleware.env -f docker-compose.middleware.yaml -p dify up -d` to start PostgreSQL/MySQL (per `DB_TYPE`) plus the bundled Weaviate instance.

> Compose automatically loads `COMPOSE_PROFILES=${DB_TYPE:-postgresql},weaviate` from `middleware.env`, so no extra `--profile` flags are needed. Adjust variables in `middleware.env` if you want a different combination of services.

### Migration for Existing Users

For users migrating from the `docker-legacy` setup:

1. **Review Changes**: Familiarize yourself with the new `.env` configuration and Docker Compose setup.
1. **Transfer Customizations**:
   - If you have customized configurations such as `docker-compose.yaml`, `ssrf_proxy/squid.conf`, or `nginx/conf.d/default.conf`, you will need to reflect these changes in the `.env` file you create.
1. **Data Migration**:
   - Ensure that data from services like databases and caches is backed up and migrated appropriately to the new structure if necessary.

### Overview of `.env`, `.env.example`, and `envs/`

- `.env.example` contains the essential default configuration for Docker Compose deployments.
- `.env` contains local startup values copied from `.env.example` and any local changes.
- `envs/*.env.example` files contain optional advanced configuration grouped by theme.

Docker Compose reads `envs/*.env` files when present, then reads `.env` last so values in `.env` take precedence.

#### Key Modules and Customization

- **Vector Database Services**: Depending on the type of vector database used (`VECTOR_STORE`), users can set specific endpoints, ports, and authentication details.
- **Storage Services**: Depending on the storage type (`STORAGE_TYPE`), users can configure specific settings for S3, Azure Blob, Google Storage, etc.
- **API and Web Services**: Users can define URLs and other settings that affect how the API and web frontend operate.

#### Other notable variables

The root `.env.example` file contains the essential startup settings. Optional and provider-specific settings are grouped in `envs/*.env.example` files. Here are some of the key sections and variables:

1. **Common Variables**:

   - `CONSOLE_API_URL`, `SERVICE_API_URL`: URLs for different API services.
   - `APP_WEB_URL`: Frontend application URL.
   - `FILES_URL`: Base URL for file downloads and previews.

1. **Server Configuration**:

   - `LOG_LEVEL`, `DEBUG`, `FLASK_DEBUG`: Logging and debug settings.
   - `SECRET_KEY`: A key for signing sessions, JWTs, and file URLs. Leave it empty to let Dify generate a persistent key in the storage directory, or set a unique value yourself.

1. **Database Configuration**:

   - `DB_USERNAME`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`: PostgreSQL database credentials and connection details.

1. **Redis Configuration**:

   - `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis server connection settings.
   - `REDIS_KEY_PREFIX`: Optional global namespace prefix for Redis keys, topics, streams, and Celery Redis transport artifacts.

1. **Celery Configuration**:

   - `CELERY_BROKER_URL`: Configuration for Celery message broker.

1. **Storage Configuration**:

   - `STORAGE_TYPE`, `OPENDAL_SCHEME`, `OPENDAL_FS_ROOT`: Default local file storage settings. Optional storage backends are configured from the files under `envs/`.

1. **Vector Database Configuration**:

   - `VECTOR_STORE`: Type of vector database (e.g., `weaviate`, `milvus`).
   - Specific settings for each vector store like `WEAVIATE_ENDPOINT`, `MILVUS_URI`.

1. **CORS Configuration**:

   - `WEB_API_CORS_ALLOW_ORIGINS`, `CONSOLE_CORS_ALLOW_ORIGINS`: Settings for cross-origin resource sharing.

1. **OpenTelemetry Configuration**:

   - `ENABLE_OTEL`: Enable OpenTelemetry collector in api.
   - `OTLP_BASE_ENDPOINT`: Endpoint for your OTLP exporter.

1. **Other Service-Specific Environment Variables**:

   - Each service like `nginx`, `redis`, `db`, and vector databases have specific environment variables that are directly referenced in the `docker-compose.yaml`.

### Environment Variables Synchronization

When upgrading Dify or pulling the latest changes, new environment variables may be introduced in `.env.example` or the optional files under `envs/`.

If you use the default workflow, review `.env.example` and keep your `.env` aligned with essential startup values.

If you maintain a customized `.env` file copied from `.env.example`, an optional environment variables synchronization tool is provided.

> This tool performs a **one-way synchronization** from `.env.example` to `.env`.
> Existing values in `.env` are never overwritten automatically.

#### `dify-env-sync.sh` (Optional)

This script compares your current `.env` file with the latest `.env.example` template and helps safely apply new or updated environment variables.

**What it does**

- Creates a backup of the current `.env` file before making any changes
- Synchronizes newly added environment variables from `.env.example`
- Preserves all existing custom values in `.env`
- Displays differences and variables removed from `.env.example` for review

**Backup behavior**

Before synchronization, the current `.env` file is saved to the `env-backup/` directory with a timestamped filename
(e.g. `env-backup/.env.backup_20231218_143022`).

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

### Additional Information

- **Continuous Improvement Phase**: We are actively seeking feedback from the community to refine and enhance the deployment process. As more users adopt this new method, we will continue to make improvements based on your experiences and suggestions.
- **Support**: For detailed configuration options and environment variable settings, refer to the `.env.example` file and the Docker Compose configuration files in the `docker` directory.

This README aims to guide you through the deployment process using the new Docker Compose setup. For any issues or further assistance, please refer to the official documentation or contact support.
