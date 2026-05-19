# /dev-start

Start the full Nexoraa Dify stack locally by building images from source. No AWS access required.

## Steps

### 1. Check prerequisites

```bash
docker info > /dev/null 2>&1 && echo "Docker running ✅" || echo "ERROR: Docker is not running"
ls /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml > /dev/null 2>&1 && echo "Repo found ✅" || echo "ERROR: repo not found"
```

If Docker is not running, tell the user to start Docker Desktop and stop.

### 2. Create .env.local if it doesn't exist

```bash
ENV_FILE=/Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local

if [ ! -f "$ENV_FILE" ]; then
  cp /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.example "$ENV_FILE"
  SECRET=$(openssl rand -base64 42)
  sed -i '' "s|SECRET_KEY=your-secret-key-here|SECRET_KEY=${SECRET}|" "$ENV_FILE"
  sed -i '' "s|CONSOLE_WEB_URL=http://your-server-ip|CONSOLE_WEB_URL=http://localhost|" "$ENV_FILE"
  sed -i '' "s|APP_WEB_URL=http://your-server-ip|APP_WEB_URL=http://localhost|" "$ENV_FILE"
  sed -i '' "s|ECR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com|ECR_REGISTRY=|" "$ENV_FILE"
  echo "Created deploy/.env.local with defaults ✅"
else
  echo "deploy/.env.local already exists ✅"
fi
```

### 3. Build images from source

Inform the user: first build takes 10-15 minutes. Docker caches layers so subsequent runs take ~30 seconds.

```bash
docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.local.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  build api web
```

### 4. Start all services

```bash
docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.local.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  up -d
```

### 5. Wait for API to be healthy (max 60 seconds)

```bash
echo "Waiting for API to be ready..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost/apps 2>/dev/null | grep -q "200"; then
    echo "API is ready ✅"
    break
  fi
  sleep 2
done
```

### 6. Show final status

```bash
docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.local.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  ps --format "table {{.Name}}\t{{.Image}}\t{{.Status}}"
```

Then print:

```
✅ Nexoraa Dify is running locally!

  App:     http://localhost
  Console: http://localhost/apps

To stop:      /dev-stop
To view logs: docker compose -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml --env-file deploy/.env.local logs -f api
```
