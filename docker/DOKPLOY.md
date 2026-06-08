# Deploying Dify on Dokploy

This guide shows how to deploy Dify on a [Dokploy](https://dokploy.com) host
using the dedicated compose file in this repository.

The setup ships PostgreSQL, Redis, Weaviate, Sandbox, SSRF proxy, Plugin
Daemon and an internal Nginx — all wired up so that Dokploy's Traefik can
front the stack on a domain you choose.

## Files

| File | Purpose |
| ---- | ------- |
| `docker/docker-compose.dokploy.yaml` | Dokploy-ready compose (no `container_name`, named volumes, Traefik labels). |
| `docker/.env.dokploy.example` | Minimum env vars to set in the Dokploy UI. |
| `docker/postgres-init/01-create-plugin-db.sh` | First-boot script that creates the `dify_plugin` database (plugin_daemon expects it to exist). |

## Why a separate compose file?

The default `docker/docker-compose.yaml` is tuned for a self-managed host
with its own ports + certbot. Dokploy already provides Traefik with
Let's Encrypt and treats certain compose features as anti-patterns. The
Dokploy file fixes the common pitfalls:

1. **No `container_name`** — Dokploy attaches its logging/metrics by the
   compose-generated names; explicit `container_name` breaks both.
2. **Named volumes only** — Dokploy re-clones the repository on every
   deploy, so any bind mount under `./volumes/` would be wiped. Switching
   to named volumes also enables Dokploy's Volume Backups feature.
3. **No published host ports** — port 80/443 are owned by Dokploy's
   Traefik. Internal nginx listens on port 80 only inside the compose
   network; Traefik forwards to it via the external `dokploy-network`.
4. **External `dokploy-network`** — required so Traefik can reach the
   container at all. The `traefik.docker.network=dokploy-network` label
   tells Traefik which network to use when there are multiple.
5. **Internal nginx kept** — Dify needs path-based routing
   (`/console`, `/api`, `/socket.io`, `/e/`, `/`) onto three different
   backends. Letting Dify's nginx do that and pointing Traefik at the
   single nginx service is far simpler than recreating each route as
   Traefik labels.
6. **Certbot removed** — Dokploy already issues and renews Let's Encrypt
   certificates via Traefik.
7. **Postgres init script bundled** — `docker/postgres-init/` is
   bind-mounted into `/docker-entrypoint-initdb.d` so the `dify_plugin`
   database (required by plugin_daemon) is created on first boot. Postgres
   only runs this when the data volume is empty, so subsequent deploys
   are no-ops.

## Step-by-step

### 1. Prepare DNS

Point an `A` (or `AAAA`) record from your domain to the Dokploy host.
Do this **before** adding the domain in Dokploy so Let's Encrypt's
HTTP-01 challenge can succeed on first deploy.

### 2. Create a Compose service in Dokploy

* New Service → **Compose**
* Source: this Git repository, branch of your choice
* **Compose Path**: `docker/docker-compose.dokploy.yaml`
* Compose Type: `docker-compose`

### 3. Set environment variables

Open the **Environment** tab and paste the contents of
`docker/.env.dokploy.example`. Replace the `CHANGE_ME_*` values and the
`dify.example.com` placeholders with your real domain. Save.

Generate strong values with:

```
openssl rand -base64 42
```

at least for `DB_PASSWORD`, `REDIS_PASSWORD`, `SANDBOX_API_KEY`,
`PLUGIN_DAEMON_KEY`, `PLUGIN_DIFY_INNER_API_KEY`, and `WEAVIATE_API_KEY`.

### 4. Attach the domain

Domains tab → **Add Domain**:

* Host: `dify.example.com`
* Service: `nginx`
* Container Port: `80`
* HTTPS: ✅
* Certificate Provider: Let's Encrypt
* Path: `/`

Dokploy will write a Traefik router for the `nginx` service.

### 5. Deploy

Hit Deploy. First build pulls about 4–5 GB of images. After the
containers report healthy:

1. Open `https://dify.example.com`.
2. Complete the bootstrap wizard with the email of your choice and the
   `INIT_PASSWORD` you set in the env tab.

## Common gotchas

* **Bad Gateway / 404 for ~30s after deploy** — Traefik needs about
  10 seconds to attach to the new container, then nginx needs to wait
  for `api` and `web` to become healthy. Wait it out.
* **`dokploy-network not found`** — only happens if you copy this
  compose to a host without Dokploy. Create the network manually:
  `docker network create dokploy-network`.
* **Certificate not issued** — confirm the DNS record resolves to the
  Dokploy host before adding the domain; redeploy after fixing DNS.
* **WebSocket disconnects** — make sure `NEXT_PUBLIC_SOCKET_URL` uses
  `wss://` (not `https://`) and points to the same host as the rest of
  the URLs.
* **Lost data on redeploy** — verify volumes are listed under the
  service's Volumes tab in Dokploy. If you see bind mounts pointing to
  `./volumes/...`, you are deploying the wrong compose file.
* **Plugins can't reach api** — `PLUGIN_DIFY_INNER_API_URL` must stay
  `http://api:5001` (the internal compose hostname), not the public URL.
* **Forgot `INIT_PASSWORD`** — bring the stack down, set a new value in
  the env tab, scale `db_postgres` volume down/up, and redeploy. Easier:
  set it once on the very first deploy.

## Switching the vector store

The default file uses Weaviate. To use Qdrant/Milvus/pgvector instead:

1. Replace the `weaviate` service block with the desired service from
   `docker/docker-compose.yaml` (and add its named volume to the
   `volumes:` section at the bottom).
2. Override `VECTOR_STORE` and the relevant endpoint vars in the env tab
   (see `docker/envs/vectorstores/*.env.example` for the full list).
3. Redeploy.

## Scaling tips

* `SERVER_WORKER_AMOUNT` (api Gunicorn workers) and
  `CELERY_WORKER_AMOUNT` (worker concurrency) are the two main knobs.
  Start at `2`/`2` on a 4 vCPU box.
* `NGINX_CLIENT_MAX_BODY_SIZE` defaults to `100M`. Raise it if you allow
  larger document uploads.
* Run Dokploy's Volume Backup on `db_postgres_data`, `app_storage`,
  `plugin_daemon_storage`, and `weaviate_data`.

## Updating Dify

Pin the image tags inside `docker-compose.dokploy.yaml`
(`dify-api`, `dify-web`, `dify-sandbox`, `dify-plugin-daemon`) and
redeploy. Dokploy will pull the new tags and rebuild only the affected
containers; named volumes are preserved.
