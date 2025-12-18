## README for docker Deployment

Welcome to the new `docker` directory for deploying Dify using Docker Compose. This README outlines the updates, deployment instructions, and migration details for existing users.

### What's Updated

- **Certbot Container**: `docker-compose.yaml` now contains `certbot` for managing SSL certificates. This container automatically renews certificates and ensures secure HTTPS connections.\
  For more information, refer `docker/certbot/README.md`.

- **Persistent Environment Variables**: Environment variables are now managed through a `.env` file, ensuring that your configurations persist across deployments.

  > What is `.env`? </br> </br>
  > The `.env` file is a crucial component in Docker and Docker Compose environments, serving as a centralized configuration file where you can define environment variables that are accessible to the containers at runtime. This file simplifies the management of environment settings across different stages of development, testing, and production, providing consistency and ease of configuration to deployments.

- **Unified Vector Database Services**: All vector database services are now managed from a single Docker Compose file `docker-compose.yaml`. You can switch between different vector databases by setting the `VECTOR_STORE` environment variable in your `.env` file.

- **Mandatory .env File**: A `.env` file is now required to run `docker compose up`. This file is crucial for configuring your deployment and for any custom settings to persist through upgrades.

### How to Deploy Dify with `docker-compose.yaml`

1. **Prerequisites**: Ensure Docker and Docker Compose are installed on your system.
1. **Environment Setup**:
   - Navigate to the `docker` directory.
   - Copy the `.env.example` file to a new file named `.env` by running `cp .env.example .env`.
   - Customize the `.env` file as needed. Refer to the `.env.example` file for detailed configuration options.
   - **Optional (Recommended for upgrades)**:
     You may use the environment synchronization tool to help keep your `.env` file aligned with the latest `.env.example` updates, while preserving your custom settings.
     This is especially useful when upgrading Dify or managing a large, customized `.env` file.
     See the [Environment Variables Synchronization](#environment-variables-synchronization) section below.
1. **Running the Services**:
   - Execute `docker compose up` from the `docker` directory to start the services.
   - To specify a vector database, set the `VECTOR_STORE` variable in your `.env` file to your desired vector database service, such as `milvus`, `weaviate`, or `opensearch`.
1. **SSL Certificate Setup**:
   - Refer `docker/certbot/README.md` to set up SSL certificates using Certbot.
1. **OpenTelemetry Collector Setup**:
   - Change `ENABLE_OTEL` to `true` in `.env`.
   - Configure `OTLP_BASE_ENDPOINT` properly.

### How to Deploy Middleware for Developing Dify

1. **Middleware Setup**:
   - Use the `docker-compose.middleware.yaml` for setting up essential middleware services like databases and caches.
   - Navigate to the `docker` directory.
   - Ensure the `middleware.env` file is created by running `cp middleware.env.example middleware.env` (refer to the `middleware.env.example` file).
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

### Overview of `.env`

#### Key Modules and Customization

- **Vector Database Services**: Depending on the type of vector database used (`VECTOR_STORE`), users can set specific endpoints, ports, and authentication details.
- **Storage Services**: Depending on the storage type (`STORAGE_TYPE`), users can configure specific settings for S3, Azure Blob, Google Storage, etc.
- **API and Web Services**: Users can define URLs and other settings that affect how the API and web frontend operate.

#### Other notable variables

The `.env.example` file provided in the Docker setup is extensive and covers a wide range of configuration options. It is structured into several sections, each pertaining to different aspects of the application and its services. Here are some of the key sections and variables:

1. **Common Variables**:

   - `CONSOLE_API_URL`, `SERVICE_API_URL`: URLs for different API services.
   - `APP_WEB_URL`: Frontend application URL.
   - `FILES_URL`: Base URL for file downloads and previews.

1. **Server Configuration**:

   - `LOG_LEVEL`, `DEBUG`, `FLASK_DEBUG`: Logging and debug settings.
   - `SECRET_KEY`: A key for encrypting session cookies and other sensitive data.

1. **Database Configuration**:

   - `DB_USERNAME`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`: PostgreSQL database credentials and connection details.

1. **Redis Configuration**:

   - `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`: Redis server connection settings.

1. **Celery Configuration**:

   - `CELERY_BROKER_URL`: Configuration for Celery message broker.

1. **Storage Configuration**:

   - `STORAGE_TYPE`, `S3_BUCKET_NAME`, `AZURE_BLOB_ACCOUNT_NAME`: Settings for file storage options like local, S3, Azure Blob, etc.

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

When upgrading Dify or pulling the latest changes, new environment variables may be introduced in `.env.example`.

To help keep your existing `.env` file up to date **without losing your custom values**, an optional environment variables synchronization tool is provided.

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

- After upgrading Dify to a newer version
- When `.env.example` has been updated with new environment variables
- When managing a large or heavily customized `.env` file

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
