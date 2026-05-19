# /dev-stop

Stop the local Nexoraa Dify stack. Data (Postgres, Redis) is preserved in deploy/volumes/.

## Steps

### 1. Stop all services

```bash
docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  down
```

### 2. Confirm stopped

```bash
docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  ps
```

Then print:

```
✅ Local stack stopped. Your data is preserved in deploy/volumes/.
   Run /dev-start to start again.
```
