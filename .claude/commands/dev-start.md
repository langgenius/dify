# /dev-start

Start the full Nexoraa Dify stack locally using Docker Compose. Handles both AWS users (pulls ECR images) and non-AWS users (builds from source).

## Steps

### 1. Check prerequisites

Run these checks before anything else:

```bash
# Docker running?
docker info > /dev/null 2>&1 || echo "ERROR: Docker is not running"

# Repo root
ls /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml > /dev/null 2>&1 || \
  echo "ERROR: Run this command from inside the Nexoraa dify repo"
```

If Docker is not running, tell the user to start Docker Desktop and stop.

### 2. Create .env.local if it doesn't exist

```bash
ENV_FILE=/Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local

if [ ! -f "$ENV_FILE" ]; then
  cp /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.example "$ENV_FILE"
  # Generate a fresh secret key
  SECRET=$(openssl rand -base64 42)
  sed -i '' "s|SECRET_KEY=your-secret-key-here|SECRET_KEY=${SECRET}|" "$ENV_FILE"
  sed -i '' "s|CONSOLE_WEB_URL=http://your-server-ip|CONSOLE_WEB_URL=http://localhost|" "$ENV_FILE"
  sed -i '' "s|APP_WEB_URL=http://your-server-ip|APP_WEB_URL=http://localhost|" "$ENV_FILE"
  # Remove ECR_REGISTRY for local (not needed when building from source)
  sed -i '' "s|ECR_REGISTRY=<ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com|ECR_REGISTRY=|" "$ENV_FILE"
  echo "Created deploy/.env.local with defaults"
else
  echo "deploy/.env.local already exists, using it"
fi
```

### 3. Detect whether user has AWS access

```bash
if aws sts get-caller-identity --region ap-south-1 > /dev/null 2>&1; then
  echo "AWS_ACCESS=yes"
else
  echo "AWS_ACCESS=no"
fi
```

### 4a. If AWS access — pull images from ECR (fast, ~1 min)

```bash
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin \
  902451183446.dkr.ecr.ap-south-1.amazonaws.com

# Set ECR_REGISTRY in .env.local
sed -i '' "s|ECR_REGISTRY=.*|ECR_REGISTRY=902451183446.dkr.ecr.ap-south-1.amazonaws.com|" \
  /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local

docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  pull api web worker
```

### 4b. If no AWS access — build images from source (first time ~10-15 min, then cached)

```bash
docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.local.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  build api web
```

Inform the user: first build takes 10-15 minutes. Subsequent runs use Docker layer cache and take ~30 seconds.

### 5. Start all services

**If AWS access:**
```bash
docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  up -d
```

**If no AWS access:**
```bash
docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.local.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  up -d
```

### 6. Wait for api to be healthy

Poll until the API responds (max 60 seconds):

```bash
echo "Waiting for API to be ready..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost/api/health 2>/dev/null | grep -q "200"; then
    echo "API is ready!"
    break
  fi
  sleep 2
done
```

### 7. Show final status

```bash
docker compose \
  -f /Users/narayana-nexoraa/Developer/HSD/dify/deploy/docker-compose.yml \
  --env-file /Users/narayana-nexoraa/Developer/HSD/dify/deploy/.env.local \
  ps --format "table {{.Name}}\t{{.Image}}\t{{.Status}}"
```

Then print:

```
✅ Nexoraa Dify is running locally!

  App:     http://localhost
  Console: http://localhost/apps

To stop: /dev-stop
To view logs: docker compose -f deploy/docker-compose.yml --env-file deploy/.env.local logs -f api
```
