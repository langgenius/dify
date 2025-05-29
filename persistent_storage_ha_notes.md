## Persistent Storage in a High Availability (HA) Dify Setup

### 1. The Criticality of Shared Storage for HA

In a High Availability (HA) environment, stateful services (those that need to read and write data to disk) must have their data stored on **shared, resilient network storage**. This storage must be accessible by all Docker Swarm nodes (or Kubernetes nodes, etc.) that could potentially run a replica of the service.

When a container running a stateful service fails or is rescheduled to a different node, its replacement must be able to access the exact same data to ensure continuity and prevent data loss or inconsistency. Local host-path volumes are **not suitable** for HA because if the host goes down, the data on that host becomes unavailable.

### 2. Services Requiring Shared Storage in `docker-compose.ha.yml`

The following services in the provided `docker-compose.ha.yml` are stateful and their data volumes **must** be configured to use shared network storage for a true HA deployment:

*   **`db` (PostgreSQL):**
    *   **Volume:** `/var/lib/postgresql/data`
    *   **Reason:** Contains all core Dify application data, user information, knowledge bases, chat histories, etc. This is the most critical data to protect.
*   **`redis-master` (Redis):**
    *   **Volume:** `/data`
    *   **Reason:** While Redis is often used as a cache, it can also be used for persistent message queuing (Celery broker) and potentially other features. If Redis persistence is enabled (as it is by default for the master in the provided setup), this data should be on shared storage to allow a seamless recovery or failover if the Redis master container needs to be restarted on a different node. For a full HA Redis setup with Sentinel, the master's data persistence ensures that if a failover occurs and a slave is promoted (not applicable in the current single-master Sentinel setup but relevant for more advanced Redis HA), or if the master restarts, it can recover its state.
*   **`weaviate` (or other vector stores):**
    *   **Volume:** `/var/lib/weaviate` (for Weaviate)
    *   **Reason:** Stores all vector embeddings for knowledge bases. Losing this data would require re-indexing all documents.
*   **`api` and `worker` (Dify application file storage):**
    *   **Volume:** `/app/api/storage`
    *   **Reason:** This volume is used if you configure Dify with `STORAGE_TYPE=opendal` and `OPENDAL_SCHEME=fs`. It stores user-uploaded files (e.g., knowledge base documents, images in chat). For HA, all `api` and `worker` replicas must access the same file storage.
    *   **Highly Recommended Alternative:** Use object storage like S3, Azure Blob, Google Cloud Storage, etc. See section 5.
*   **`plugin_daemon`:**
    *   **Volume:** `/app/storage` (mapped from `./volumes/plugin_daemon`)
    *   **Reason:** Used for storing installed plugin packages and potentially other plugin-related data if `PLUGIN_STORAGE_TYPE=local`. If plugins are downloaded or managed by one replica, other replicas need access to the same plugin assets.
    *   **Recommended Alternative for HA:** Configure `PLUGIN_STORAGE_TYPE` to use a shared object storage solution (S3, Azure Blob, etc.) as detailed in Dify's plugin documentation.
*   **`sandbox`:**
    *   **Volume 1:** `/dependencies`
    *   **Volume 2:** `/conf`
    *   **Reason:**
        *   `/dependencies`: This volume is used to cache downloaded dependencies for sandboxed code execution. While it might be treated as a cache that can be rebuilt, sharing it could speed up cold starts for sandbox instances on new nodes. For true HA and consistent behavior, shared storage might be preferred if dependency resolution is time-consuming or complex.
        *   `/conf`: Stores configuration for the sandbox environment. Changes here should be consistent across replicas.
        *   In a strict HA setup, both might be better on shared storage, though `/dependencies` could be less critical if startup times are acceptable.

### 3. How to Configure Shared Storage

The default `docker-compose.ha.yml` uses host-relative paths (e.g., `./volumes/db/data:/var/lib/postgresql/data`) for volume mounts. This maps the container's data directory to a directory on the specific Docker host running the container. **This is NOT HA-compliant.**

For a true HA deployment, these host paths **MUST be replaced** with one of the following shared storage strategies:

*   **A. Named Volumes with External Storage Drivers:**
    This is often the recommended approach with Docker Swarm. You define a named volume and configure a Docker storage driver that interfaces with your network storage solution (NFS, iSCSI, cloud provider block storage plugins like AWS EBS, Azure Disk, GCP Persistent Disk, etc.).

    **Conceptual Example:**

    ```yaml
    # At the top-level of docker-compose.ha.yml
    volumes:
      postgres_data_ha:
        driver: your-chosen-network-storage-driver # e.g., 'local' for NFS if pre-configured, or a cloud plugin
        driver_opts:
          # Options specific to your driver, e.g., for NFS:
          # type: "nfs"
          # o: "addr=nfs.example.com,rw,nfsvers=4,soft"
          # device: ":/exports/dify_postgres_data"
          # For cloud drivers, refer to their specific documentation.

    services:
      db:
        # ... other db service config ...
        volumes:
          - postgres_data_ha:/var/lib/postgresql/data
      
      redis-master:
        # ... other redis-master config ...
        volumes:
          - redis_data_ha:/data # Assuming 'redis_data_ha' is another named volume

      # ... and similarly for weaviate, api/worker storage, plugin_daemon, sandbox ...
    ```
    You would need to create corresponding named volumes (e.g., `redis_data_ha`, `weaviate_data_ha`, etc.) for each stateful service. The specific `driver` and `driver_opts` will depend heavily on your chosen storage technology and Docker environment (Swarm, Kubernetes with a CSI driver, etc.).

*   **B. Bind Mounting Pre-mounted Network Paths:**
    Alternatively, you can pre-mount your network storage (e.g., an NFS share, GlusterFS mount, etc.) onto a consistent path on *all* Docker Swarm nodes that are part of the cluster. Then, you use this consistent host path as a bind mount in your `docker-compose.ha.yml`.

    **Example:**
    If you have an NFS share mounted at `/mnt/shared/dify/` on all your Docker hosts:

    ```yaml
    services:
      db:
        # ... other db service config ...
        volumes:
          - /mnt/shared/dify/postgres_data:/var/lib/postgresql/data
      
      redis-master:
        # ... other redis-master config ...
        volumes:
          - /mnt/shared/dify/redis_data:/data

      # ... and similarly for other stateful services ...
    ```
    This approach requires careful management of the underlying host mounts and ensuring they are always available before Docker services start.

### 4. Consequences of Not Using Shared Storage

If stateful services are run in an HA orchestrator (like Docker Swarm) without their data volumes on shared network storage:

*   **Data Loss:** If a node running a service replica fails, and the orchestrator starts a new replica on a different node, the new replica will not have access to the data from the failed node. It will likely start with an empty or initialized data directory, leading to data loss.
*   **Data Inconsistency:** Different replicas of a service might end up with different data sets if they are writing to local, non-shared volumes.
*   **Stateful Failover Impossible:** True automatic failover of stateful services is not possible without shared storage.

### 5. Alternative for Dify Application File Storage (`/app/api/storage`)

For the Dify application's file storage (used by `api` and `worker` services when `OPENDAL_SCHEME=fs`), it is **highly recommended to use a dedicated object storage service** like AWS S3, Google Cloud Storage, Azure Blob Storage, MinIO, or other S3-compatible solutions. This is generally more scalable, resilient, and easier to manage for HA than filesystem-based shared storage for this specific purpose.

Configure Dify to use object storage via the following environment variables:

*   `STORAGE_TYPE=opendal` (or other types like `s3`, `azure-blob` depending on Dify version and specific adapter)
*   `OPENDAL_SCHEME=<s3, azure, gcs, etc.>`
*   And the relevant credentials and bucket information (e.g., `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, etc.).

Using a managed object storage service offloads the complexity of storage HA to the cloud provider or your object storage solution. This is generally the preferred method for Dify's application file storage in an HA environment. The same applies to `PLUGIN_STORAGE_TYPE` for the `plugin_daemon` service.
