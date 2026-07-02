# Upgrade From 1.14.2-enterprise To 1.15.0-enterprise

This guide is for upgrading an existing `1.14.2-enterprise` Docker deployment to
`1.15.0-enterprise`.

## Artifacts

Use the two release artifacts:

- `dify-enterprise-offline-1.15.0-enterprise.tar`
- `dify-enterprise-config-1.15.0-enterprise.tar.gz`

## 1. Backup First

Run from the existing `1.14.2-enterprise` deployment directory:

```bash
export BACKUP_DIR=/data/backups/dify-1.14.2-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

cp -a docker/.env "$BACKUP_DIR/.env"
cp -a docker/volumes "$BACKUP_DIR/volumes"
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml ps > "$BACKUP_DIR/compose-ps.txt"
```

Stop the old stack before copying runtime data:

```bash
docker compose -f docker/docker-compose.yaml -f docker/docker-compose.enterprise.yaml down
```

## 2. Prepare The 1.15.0 Directory

Create a new deployment directory for `1.15.0-enterprise`, then unpack the
configuration bundle there:

```bash
mkdir -p /opt/dify-enterprise-1.15.0
cd /opt/dify-enterprise-1.15.0
tar -xzf /path/to/dify-enterprise-config-1.15.0-enterprise.tar.gz
```

Load images if this is an offline deployment:

```bash
docker load -i /path/to/dify-enterprise-offline-1.15.0-enterprise.tar
```

## 3. Migrate Runtime Data

Copy the old `.env` and volumes into the new directory:

```bash
cp -a /path/to/dify-enterprise-1.14.2/docker/.env docker/.env
cp -a /path/to/dify-enterprise-1.14.2/docker/volumes docker/volumes
```

If PostgreSQL files cannot be copied by the host user, copy with a temporary
root container:

```bash
docker run --rm \
  -v /path/to/dify-enterprise-1.14.2/docker/volumes:/old:ro \
  -v /opt/dify-enterprise-1.15.0/docker/volumes:/new \
  busybox:latest \
  sh -c 'rm -rf /new/db && mkdir -p /new && cp -a /old/db /new/db'
```

Edit `docker/.env` and update version/runtime values:

```bash
DIFY_ENTERPRISE_VERSION=1.15.0-enterprise
COMPOSE_PROFILES=weaviate,postgresql,collaboration
```

If plugins must install dependencies in a restricted network, set a PyPI mirror:

```bash
PIP_MIRROR_URL=https://pypi.tuna.tsinghua.edu.cn/simple
```

## 4. Start 1.15.0

Run from `/opt/dify-enterprise-1.15.0`:

```bash
export DIFY_ENTERPRISE_VERSION=1.15.0-enterprise
export COMPOSE_PROFILES=weaviate,postgresql,collaboration

docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yaml \
  -f docker/docker-compose.enterprise.yaml \
  config --images | sort -u
```

The image list must include:

```text
dify-api-enterprise:1.15.0-enterprise
dify-web-enterprise:1.15.0-enterprise
```

It must not show `1.14.2-enterprise` for API/Web/worker/websocket services.

Start the stack:

```bash
docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yaml \
  -f docker/docker-compose.enterprise.yaml \
  up -d --force-recreate --pull never
```

## 5. Run Required Migrations

Run database migration:

```bash
docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yaml \
  -f docker/docker-compose.enterprise.yaml \
  exec api flask db upgrade
```

Run the required official 1.15.0 plugin backfill:

```bash
docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yaml \
  -f docker/docker-compose.enterprise.yaml \
  exec api flask backfill-plugin-auto-upgrade
```

## 6. Verify Vector Indexes

This step prevents the common case where PostgreSQL data migrated but Weaviate
started with an empty or wrong volume.

```bash
scripts/check-enterprise-vector-indexes.sh
```

If missing classes are reported, rebuild only the missing vector indexes from
existing Postgres documents and segments:

```bash
scripts/check-enterprise-vector-indexes.sh --repair
scripts/check-enterprise-vector-indexes.sh
```

## 7. Verify Runtime

Check services:

```bash
docker compose \
  --env-file docker/.env \
  -f docker/docker-compose.yaml \
  -f docker/docker-compose.enterprise.yaml \
  ps
```

Confirm images:

```bash
docker inspect docker-api-1 docker-api_websocket-1 docker-worker-1 docker-worker_beat-1 docker-web-1 \
  --format '{{.Name}} {{.Config.Image}}'
```

Expected:

```text
dify-api-enterprise:1.15.0-enterprise
dify-web-enterprise:1.15.0-enterprise
```

Open the web UI and verify:

- login with existing admin account
- workspaces and users exist
- apps and workflows open
- plugins list opens
- knowledge base hit testing returns right-side results
- enterprise marketplace / 智慧广场 opens

## Rollback

If upgrade validation fails:

1. Stop the `1.15.0-enterprise` stack.
2. Restart the old `1.14.2-enterprise` directory with the backed-up `.env` and
   `docker/volumes`.
3. Do not reuse partially migrated `1.15.0` runtime data as rollback source.
