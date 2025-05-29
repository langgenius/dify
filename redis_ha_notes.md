## Redis High Availability (HA) with Sentinel

The `docker-compose.ha.yml` file includes a Redis setup configured for High Availability using Redis Sentinel. This setup consists of:

*   One `redis-master` service: The primary Redis instance.
*   Three `redis-sentinel-*` services: These sentinels monitor the master. If the master becomes unavailable, the sentinels will elect a new master (though in this Docker Compose setup, there's only one master candidate, so it's more about monitoring and providing a consistent connection endpoint for the application).

### Alternative for Production: External Managed Redis

For robust production HA, it is **strongly recommended to use an external, managed Redis service** (e.g., AWS ElastiCache, Google Cloud Memorystore, Azure Cache for Redis). These services typically offer better resilience, automated failover, and easier management than a self-managed Sentinel setup within Docker.

If you use an external Redis service, you can comment out or remove the `redis-master` and `redis-sentinel-*` services from `docker-compose.ha.yml`. You will then configure Dify to connect directly to your managed Redis instance using its provided endpoint and credentials, ensuring `REDIS_USE_SENTINEL` is set to `false`.

### Environment Variables for Sentinel Configuration

To configure Dify to connect to Redis using the Sentinel setup provided in `docker-compose.ha.yml`, you need to set the following environment variables (e.g., in your `.env.ha.example` or deployment environment):

*   `REDIS_HOST=redis-master`
    *   Specifies the hostname for the Redis master. This should match the service name in `docker-compose.ha.yml`.
*   `REDIS_PORT=6379`
    *   The port Redis master is listening on.
*   `REDIS_PASSWORD=${YOUR_REDIS_PASSWORD:-difyai123456}`
    *   The password for your Redis master. This **must** be consistent across `redis-master` configuration, `sentinel auth-pass` in each sentinel's configuration file, and this environment variable.
*   `REDIS_USE_SENTINEL=true`
    *   Tells Dify to use the Sentinel protocol for connecting to Redis.
*   `REDIS_SENTINELS=redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379`
    *   A comma-separated list of sentinel host:port pairs. These must match the service names and ports of the sentinel services in `docker-compose.ha.yml`.
*   `REDIS_SENTINEL_SERVICE_NAME=dify-master-group`
    *   The name of the master group defined in the sentinel configuration files (`sentinel monitor <name> ...`). This **must** match the name used in `docker/redis-ha/sentinel*.conf`.
*   `REDIS_SENTINEL_PASSWORD=${YOUR_REDIS_PASSWORD:-difyai123456}`
    *   The password used by Sentinels to authenticate with a password-protected Redis master. This should be the same as `REDIS_PASSWORD`. If the master does not have a password, this can be left blank, but `sentinel auth-pass` must also be commented out in sentinel configs.
*   `CELERY_BROKER_URL=sentinel://redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379/1`
    *   The Celery broker URL configured for Sentinel. The `/1` at the end specifies Redis database number 1. Adjust if needed. You can also add `password=${YOUR_REDIS_PASSWORD}` within the sentinel part if needed, e.g., `sentinel://:${YOUR_REDIS_PASSWORD}@redis-sentinel-1:26379...` but it's often better to rely on `CELERY_SENTINEL_PASSWORD` if the library supports it.
*   `CELERY_USE_SENTINEL=true`
    *   Enables Sentinel mode for Celery's Redis backend.
*   `CELERY_SENTINEL_MASTER_NAME=dify-master-group`
    *   The name of the master group Celery should look for, matching `REDIS_SENTINEL_SERVICE_NAME`.
*   `CELERY_SENTINEL_PASSWORD=${YOUR_REDIS_PASSWORD:-difyai123456}`
    *   Password for Celery to authenticate with Redis master via Sentinel.

### Sentinel Configuration for Password Authentication

If your `redis-master` is configured with a password (which it is by default with `command: redis-server --requirepass ${REDIS_PASSWORD:-difyai123456}` in `docker-compose.ha.yml`), you **must** uncomment and configure the `sentinel auth-pass` directive in each of the sentinel configuration files:

*   `docker/redis-ha/sentinel1.conf`
*   `docker/redis-ha/sentinel2.conf`
*   `docker/redis-ha/sentinel3.conf`

Example line to uncomment and ensure the password matches `REDIS_PASSWORD`:
`sentinel auth-pass dify-master-group ${REDIS_PASSWORD:-difyai123456}`

**Consistency of `REDIS_PASSWORD` is crucial.** The same password should be used for:
1.  The `redis-master` service's `command` in `docker-compose.ha.yml`.
2.  The `sentinel auth-pass` directive in each `docker/redis-ha/sentinel*.conf` file.
3.  The `REDIS_PASSWORD`, `REDIS_SENTINEL_PASSWORD`, and potentially `CELERY_SENTINEL_PASSWORD` environment variables used by the Dify application.

This ensures that Sentinels can monitor the master and that the application can connect to Redis through Sentinel.Okay, I have successfully created `redis_ha_notes.md` with all the required information.

This completes all the tasks for this sub-problem.
