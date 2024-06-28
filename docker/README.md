## README for docker Deployment

Welcome to the new `docker` directory for deploying Dify using Docker Compose. This README outlines the updates, deployment instructions, and migration details for existing users.

### What's Updated
- **Persistent Environment Variables**: Environment variables are now managed through a `.env` file, ensuring that your configurations persist across deployments.
- **Unified Vector Database Services**: All vector database services are now managed from a single Docker Compose file `docker-compose.yaml`. You can switch between different vector databases by setting the `VECTOR_STORE` environment variable in your `.env` file.
- **Mandatory .env File**: A `.env` file is now required to run `docker compose up`. This file is crucial for configuring your deployment and for any custom settings to persist through upgrades.
- **Legacy Support**: Previous deployment files are now located in the `docker-legacy` directory and will no longer be maintained.

### How to Deploy Dify with `docker-compose.yaml`
1. **Prerequisites**: Ensure Docker and Docker Compose are installed on your system.
2. **Environment Setup**:
   - Navigate to the `docker` directory.
   - Copy the `.env.example` file to a new file named `.env` by running `cp .env.example .env`.
   - Customize the `.env` file as needed. Refer to the `.env.example` file for detailed configuration options.
3. **Running the Services**:
   - Execute `docker compose up` from the `docker` directory to start the services.
   - To specify a vector database, set the `VECTOR_store` variable in your `.env` file to your desired vector database service, such as `milvus`, `weaviate`, or `opensearch`.

### How to Deploy Middleware for Developing Dify
1. **Middleware Setup**:
   - Use the `docker-compose.middleware.yaml` for setting up essential middleware services like databases and caches.
   - Navigate to the `docker` directory.
   - Ensure the `middleware.env` file is created by running `cp middleware.env.example middleware.env` (refer to the `middleware.env.example` file).
2. **Running Middleware Services**:
   - Execute `docker-compose -f docker-compose.middleware.yaml up -d` to start the middleware services.

### Migration for Existing Users
For users migrating from the `docker-legacy` setup:
1. **Review Changes**: Familiarize yourself with the new `.env` configuration and Docker Compose setup.
2. **Transfer Customizations**:
   - If you have customized configurations such as `docker-compose.yaml`, `ssrf_proxy/squid.conf`, or `nginx/conf.d/default.conf`, you will need to reflect these changes in the `.env` file you create.
3. **Data Migration**:
   - Ensure that data from services like databases and caches is backed up and migrated appropriately to the new structure if necessary.

### Additional Information
- **Continuous Improvement Phase**: We are actively seeking feedback from the community to refine and enhance the deployment process. As more users adopt this new method, we will continue to make improvements based on your experiences and suggestions.
- **Support**: For detailed configuration options and environment variable settings, refer to the `.env.example` file and the Docker Compose configuration files in the `docker` directory.

This README aims to guide you through the deployment process using the new Docker Compose setup. For any issues or further assistance, please refer to the official documentation or contact support.
