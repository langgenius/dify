# Dify Enterprise Deployment Startup

This note is included in the enterprise configuration package for deployment operators.

## Version

These commands are for `1.15.0-enterprise`.

## Before Startup

1. Load the offline image bundle if this is an offline deployment:

```bash
docker load -i dify-enterprise-offline-1.15.0-enterprise.tar
```

2. Copy the configuration bundle contents into the deployment `docker/` directory.

3. Create or update `.env` from `.env.example`, then re-apply local deployment values.

When upgrading from an older enterprise deployment, do not blindly reuse the old `.env`.
After copying the old `.env`, update version-bearing values:

```bash
DIFY_ENTERPRISE_VERSION=1.15.0-enterprise
COMPOSE_PROFILES=${VECTOR_STORE:-weaviate},${DB_TYPE:-postgresql},collaboration
```

`collaboration` starts `api_websocket`, which is required by the 1.15.0 compose runtime.

## Startup

Run from the directory that contains `docker-compose.yaml`, `docker-compose.enterprise.yaml`, and `.env`:

```bash
export DIFY_ENTERPRISE_VERSION=1.15.0-enterprise
export COMPOSE_PROFILES=weaviate,postgresql,collaboration

docker compose \
  --env-file .env \
  -f docker-compose.yaml \
  -f docker-compose.enterprise.yaml \
  config --images | sort -u
```

The image list must include these enterprise images:

```text
dify-api-enterprise:1.15.0-enterprise
dify-web-enterprise:1.15.0-enterprise
```

It must not include a previous enterprise tag such as `older-enterprise-tag`, and it must not include `langgenius/dify-api` for `api`, `api_websocket`, `worker`, or `worker_beat`.

Start or upgrade the services:

```bash
docker compose \
  --env-file .env \
  -f docker-compose.yaml \
  -f docker-compose.enterprise.yaml \
  up -d --force-recreate --pull never
```

## Verify

Check the expected services:

```bash
docker compose \
  --env-file .env \
  -f docker-compose.yaml \
  -f docker-compose.enterprise.yaml \
  ps
```

Confirm the API-family containers use the enterprise API image:

```bash
docker inspect docker-api-1 docker-api_websocket-1 docker-worker-1 docker-worker_beat-1 \
  --format '{{.Name}} {{.Config.Image}}'
```

Expected API-family image:

```text
dify-api-enterprise:1.15.0-enterprise
```

Confirm the web container uses:

```text
dify-web-enterprise:1.15.0-enterprise
```

Finally, inspect recent logs:

```bash
docker compose \
  --env-file .env \
  -f docker-compose.yaml \
  -f docker-compose.enterprise.yaml \
  logs --since=10m api api_websocket web nginx
```

During recreate, brief `502` responses can appear while API/Web are starting. They should stop after services are ready.
