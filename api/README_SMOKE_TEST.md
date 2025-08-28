# Weaviate v4 Integration — Testing Guide

This guide explains how to run and verify the Weaviate v4 integration in Dify.

---

## 🚀 Quick Start (2-minute validation)

```bash
# 1. Start services
docker run -d -p 8080:8080 -p 50051:50051 semitechnologies/weaviate:1.24.8 --host 0.0.0.0 --port 8080 --scheme http
docker run -d -p 6379:6379 --name weaviate-redis redis:7

# 2. Set Python path and run smoke test
cd /Users/dhruvgorasiya/Documents/Weaviate/Integrations/dify/api
export PYTHONPATH=$(pwd)
python scripts/smoke_test_weaviate_v4.py --endpoint http://localhost:8080 --dim 8

# 3. Cleanup
docker stop weaviate-redis 2>/dev/null || true
docker ps --filter ancestor=semitechnologies/weaviate:1.24.8 -q | xargs -r docker stop
```

---

## �� Prerequisites

- [Docker](https://docs.docker.com/get-docker/) installed and running
- [Docker Compose](https://docs.docker.com/compose/install/) (optional if you prefer CLI)
- Python 3.10+ with virtual environment activated
- Repo root: `.../dify/api`

---

## 🔧 Start Required Services

```bash
# Stop old containers if running
docker ps --filter ancestor=semitechnologies/weaviate:1.24.8 -q | xargs -r docker stop
docker ps --filter ancestor=redis:7 -q | xargs -r docker stop

# Start Weaviate (HTTP + gRPC)
docker run -d \
  -p 8080:8080 \
  -p 50051:50051 \
  semitechnologies/weaviate:1.24.8 \
  --host 0.0.0.0 --port 8080 --scheme http

# Start Redis
docker run -d -p 6379:6379 --name weaviate-redis redis:7
```
---

## �� Health Checks

```bash
# Weaviate meta (JSON output)
curl -s http://localhost:8080/v1/meta

# Redis check (should print 'PONG')
docker exec -it weaviate-redis redis-cli ping
```

---

## 🐍 Set Python Path

From the `api` folder:

```bash
cd /Users/dhruvgorasiya/Documents/Weaviate/Integrations/dify/api
export PYTHONPATH=$(pwd)     # PowerShell: $env:PYTHONPATH=(Get-Location)
```

---

## �� Run the Smoke Test

This creates a test collection, inserts docs, runs BM25 + vector search, then cleans up.

```bash
python scripts/smoke_test_weaviate_v4.py --endpoint http://localhost:8080 --dim 8
```

**Expected output highlights:**
- `Inserted: ['d1', 'd2']`
- `BM25 saw: ['d1', 'd2']`
- `near_vector raw: contains at least one hit with document_id: 'd1'`
- Ends with: `✅ Smoke test PASSED`

---

## 🧪 Run Full Pytest Suite

```bash
# Run integration tests
pytest -q tests/integration_tests/vdb/test_weaviate_v4.py

# Run unit tests
pytest -q tests/unit/test_weaviate_v4.py

# Run all tests
pytest -q tests/
```

---

## 🔍 Debug Helpers (Optional)

**List collections:**
```bash
python scripts/list_weaviate_collections.py
```

**Peek a collection's objects & vectors:**
```bash
python scripts/peek_weaviate_collection.py
```

---

## �� Cleanup

```bash
# If you used Docker CLI
docker stop weaviate-redis 2>/dev/null || true
docker ps --filter ancestor=semitechnologies/weaviate:1.24.8 -q | xargs -r docker stop

# If you used docker-compose
docker compose -f docker-compose.weaviate.yml down
```

---

## �� Troubleshooting

| Issue | Solution |
|-------|----------|
| **ModuleNotFoundError: core** | Run inside `api/` and set `PYTHONPATH`. |
| **gRPC health error** | Make sure you expose `-p 50051:50051`. |
| **BM25 works but vector search empty** | Ensure objects are inserted with:<br>• vectors under "default" key<br>• search queries specify `target_vector="default"` |
| **Redis error** | Confirm Redis is running and reachable at `localhost:6379`. |
| **Connection refused** | Check if Weaviate is running on port 8080. |
| **Import errors** | Run `pip install -e .` from the `api` directory. |

---

## �� What's Tested

### ✅ Core Functionality
- Client initialization (v4 API)
- Collection creation and management
- Document insertion with embeddings
- Vector similarity search
- BM25 text search
- Metadata-based operations
- Error handling and edge cases

### ✅ Weaviate v4 Features
- Modern Collections API
- Named vector support
- Improved batch operations
- Enhanced query building
- Better error handling

---

## 🔗 Related Files

- **Main Implementation**: `core/rag/datasource/vdb/weaviate/weaviate_vector.py`
- **Smoke Test**: `scripts/smoke_test_weaviate_v4.py`
- **Unit Tests**: `tests/unit/test_weaviate_v4.py`
- **Integration Tests**: `tests/integration_tests/vdb/weaviate/test_weaviate.py`

---

## 📝 Notes

- **Weaviate v4**: This integration uses the latest Weaviate v4 API with breaking changes from v3
- **Performance**: v4 provides better performance and more intuitive API
- **Compatibility**: Ensure your Weaviate server is running v4.x
- **Testing**: All tests use mocked dependencies to avoid external service requirements

---

## �� Contributing

When making changes to the Weaviate integration:

1. **Update tests** to cover new functionality
2. **Run the full test suite** before committing
3. **Verify with smoke test** on a real Weaviate instance
4. **Update this README** if procedures change

---

*Last updated: $(date)*
