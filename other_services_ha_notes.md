## Other Services in High Availability Setup

### Sandbox Service (`sandbox`)

*   **Role:** The `sandbox` service is responsible for executing untrusted code, such as Python tools, in an isolated environment. This is crucial for security and stability when integrating with external code or APIs.
*   **HA Configuration:** In `docker-compose.ha.yml`, the `sandbox` service is configured with `replicas: 2`. Docker Swarm's built-in load balancing will distribute requests between these replicas. Ensure your `CODE_EXECUTION_ENDPOINT` in the `.env` file points to the service name (`http://sandbox:8194`) so Docker can handle the routing.

### Plugin Daemon Service (`plugin_daemon`)

*   **Role:** The `plugin_daemon` manages the lifecycle and execution of Dify plugins. This includes handling plugin installations, updates, and runtime operations. It also exposes webhook endpoints for plugins that require them.
*   **HA Configuration:**
    *   The `plugin_daemon` service is configured with `replicas: 2` in `docker-compose.ha.yml`.
    *   **External Webhooks:** Incoming webhook calls (e.g., `/e/{hook_id}`) are load-balanced by the Nginx service, which is configured with an `upstream` block for `dify_plugin_daemon_servers`.
    *   **Internal Calls:** Direct calls from other Dify services (like `api` or `worker`) to the `plugin_daemon` (e.g., for plugin execution) are load-balanced by Docker Swarm's internal DNS and load balancing.
    *   Ensure `PLUGIN_DAEMON_URL` is set to `http://plugin_daemon:5002` for internal communication.

### SSRF Proxy Service (`ssrf_proxy`)

*   **Role:** The `ssrf_proxy` service (Squid) acts as an outbound proxy for requests made by other services, particularly the `sandbox` and potentially some tools or plugins. Its primary purpose is to mitigate Server-Side Request Forgery (SSRF) vulnerabilities by controlling and filtering outbound HTTP/HTTPS requests.
*   **HA Configuration:**
    *   In the provided `docker-compose.ha.yml`, `ssrf_proxy` runs as a **single instance**.
    *   For most Dify deployments, a single `ssrf_proxy` instance is sufficient as the volume of proxied outbound traffic is typically not a bottleneck.
    *   However, if your deployment involves extremely high volumes of outbound requests that *must* go through this proxy, or if the proxy itself becomes a critical point of failure for essential features, you might need to investigate advanced HA configurations for Squid (e.g., using multiple Squid instances with a load balancer, or features like CARP/VRRP if network setup allows). Such advanced setups are complex and outside the scope of this HA template. Ensure your `SSRF_PROXY_HTTP_URL` and `SSRF_PROXY_HTTPS_URL` correctly point to this service (e.g., `http://ssrf_proxy:3128`).

**Note on Persistent Storage for `sandbox` and `plugin_daemon`:**

*   `sandbox`: The `sandbox` service in the default configuration uses a volume for `/dependencies`. If your custom tools require persistent state *within the sandbox itself* across restarts or between replicas (which is generally not recommended for stateless sandboxed execution), you would need to consider shared storage solutions. However, for its primary role of code execution, it's typically stateless.
*   `plugin_daemon`: The `plugin_daemon` uses a volume for `/app/storage` (mapped from `./volumes/plugin_daemon`). This is used for storing plugin packages and potentially other plugin-related data. In an HA setup with multiple `plugin_daemon` replicas, this local volume means each replica has its own storage.
    *   For plugin installation and management, this is generally acceptable as plugins are usually installed/updated via API calls that would be coordinated through the Dify API service.
    *   If plugins themselves require shared persistent state *across replicas of the plugin_daemon*, you would need to configure `PLUGIN_STORAGE_TYPE` to use a shared object storage solution (like S3, Azure Blob, etc.) instead of the default `local` storage. This is detailed in Dify's plugin storage documentation. Using `local` storage with multiple `plugin_daemon` replicas means each replica might have a slightly different set of downloaded plugin assets if installations occurred at different times or were handled by different replicas, though the core Dify database would track installed plugins centrally. It's generally recommended to use shared storage for plugins in an HA environment.
