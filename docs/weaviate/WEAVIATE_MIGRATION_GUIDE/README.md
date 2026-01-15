# Weaviate Migration Guide: v1.19 → v1.27

## Overview

Dify has upgraded from Weaviate v1.19 to v1.27 with the Python client updated from v3.24 to v4.17.

## What Changed

### Breaking Changes

1. **Weaviate Server**: `1.19.0` → `1.27.0`
1. **Python Client**: `weaviate-client~=3.24.0` → `weaviate-client==4.17.0`
1. **gRPC Required**: Weaviate v1.27 requires gRPC port `50051` (in addition to HTTP port `8080`)
1. **Docker Compose**: Added temporary entrypoint overrides for client installation

### Key Improvements

- Faster vector operations via gRPC
- Improved batch processing
- Better error handling

## Migration Steps

### For Docker Users

#### Step 1: Backup Your Data

```bash
cd docker
docker compose down
sudo cp -r ./volumes/weaviate ./volumes/weaviate_backup_$(date +%Y%m%d)
```

#### Step 2: Update Dify

```bash
git pull origin main
docker compose pull
```

#### Step 3: Start Services

```bash
docker compose up -d
sleep 30
curl http://localhost:8080/v1/meta
```

#### Step 4: Verify Migration

```bash
# Check both ports are accessible
curl http://localhost:8080/v1/meta
netstat -tulpn | grep 50051

# Test in Dify UI:
# 1. Go to Knowledge Base
# 2. Test search functionality
# 3. Upload a test document
```

### For Source Installation

#### Step 1: Update Dependencies

```bash
cd api
uv sync --dev
uv run python -c "import weaviate; print(weaviate.__version__)"
# Should show: 4.17.0
```

#### Step 2: Update Weaviate Server

```bash
cd docker
docker compose -f docker-compose.middleware.yaml --profile weaviate up -d weaviate
curl http://localhost:8080/v1/meta
netstat -tulpn | grep 50051
```

## Troubleshooting

### Error: "No module named 'weaviate.classes'"

**Solution**:

```bash
cd api
uv sync --reinstall-package weaviate-client
uv run python -c "import weaviate; print(weaviate.__version__)"
# Should show: 4.17.0
```

### Error: "gRPC health check failed"

**Solution**:

```bash
# Check Weaviate ports
docker ps | grep weaviate
# Should show: 0.0.0.0:8080->8080/tcp, 0.0.0.0:50051->50051/tcp

# If missing gRPC port, add to docker-compose:
# ports:
#   - "8080:8080"
#   - "50051:50051"
```

### Error: "Weaviate version 1.19.0 is not supported"

**Solution**:

```bash
# Update Weaviate image in docker-compose
# Change: semitechnologies/weaviate:1.19.0
# To: semitechnologies/weaviate:1.27.0
docker compose down
docker compose up -d
```

### Data Migration Failed

**Solution**:

```bash
cd docker
docker compose down
sudo rm -rf ./volumes/weaviate
sudo cp -r ./volumes/weaviate_backup_YYYYMMDD ./volumes/weaviate
docker compose up -d
```

## Rollback Instructions

```bash
# 1. Stop services
docker compose down

# 2. Restore data backup
sudo rm -rf ./volumes/weaviate
sudo cp -r ./volumes/weaviate_backup_YYYYMMDD ./volumes/weaviate

# 3. Checkout previous version
git checkout <previous-commit>

# 4. Restart services
docker compose up -d
```

## Compatibility

| Component | Old Version | New Version | Compatible |
|-----------|-------------|-------------|------------|
| Weaviate Server | 1.19.0 | 1.27.0 | ✅ Yes |
| weaviate-client | ~3.24.0 | ==4.17.0 | ✅ Yes |
| Existing Data | v1.19 format | v1.27 format | ✅ Yes |

## Testing Checklist

Before deploying to production:

- [ ] Backup all Weaviate data
- [ ] Test in staging environment
- [ ] Verify existing collections are accessible
- [ ] Test vector search functionality
- [ ] Test document upload and retrieval
- [ ] Monitor gRPC connection stability
- [ ] Check performance metrics

## Support

If you encounter issues:

1. Check GitHub Issues: https://github.com/langgenius/dify/issues
1. Create a bug report with:
   - Error messages
   - Docker logs: `docker compose logs weaviate`
   - Dify version
   - Migration steps attempted

## Important Notes

- **Data Safety**: Existing vector data remains fully compatible
- **No Re-indexing**: No need to rebuild vector indexes
- **Temporary Workaround**: The entrypoint overrides are temporary until next Dify release
- **Performance**: May see improved performance due to gRPC usage
