# Apache Doris Vector Store Configuration Guide for Dify

## Prerequisites

1. **Apache Doris Installed and Running**

   - Doris FE (Frontend) running on port 8030 (HTTP) and 9030 (MySQL protocol)
   - Doris BE (Backend) started and connected to FE
   - Ensure Doris version >= 2.0 (supports vector search and text search)

1. **Create Database**

   ```sql
   CREATE DATABASE IF NOT EXISTS dify;
   ```

## Configuration Steps

### Method 1: Using Docker Compose (Recommended)

1. **Edit `.env` file** (in the `docker` directory)

   If the file doesn't exist, create it from the example file:

   ```bash
   cd docker
   cp .env.example .env
   ```

1. **Set Vector Store to Doris**

   Add or modify the following configuration in the `.env` file:

   ```bash
   # Vector Store configuration
   VECTOR_STORE=doris

   # Doris connection configuration
   DORIS_HOST=your-doris-fe-host  # Doris FE host address, e.g., localhost or 127.0.0.1
   DORIS_PORT=9030                 # Doris MySQL protocol port (default 9030)
   DORIS_USER=root                 # Doris username
   DORIS_PASSWORD=your-password    # Doris password
   DORIS_DATABASE=dify             # Database name

   # Doris StreamLoad configuration
   DORIS_STREAMLOAD_PORT=8030      # Doris HTTP port (default 8030)
   DORIS_STREAMLOAD_SCHEME=http    # HTTP scheme: http or https (default http)
   DORIS_STREAMLOAD_MAX_FILTER_RATIO=0.1  # Maximum ratio of filtered rows (0.0-1.0, default 0.1)

   # Connection pool configuration (optional)
   DORIS_MAX_CONNECTION=5          # Maximum connections (default 5)

   # Table configuration (optional)
   DORIS_TABLE_REPLICATION_NUM=1   # Table replication number (default 1)
   DORIS_TABLE_BUCKETS=10          # Number of table buckets (default 10)

   # Text search configuration (optional)
   DORIS_ENABLE_TEXT_SEARCH=true   # Enable full-text search (default true)
   DORIS_TEXT_SEARCH_ANALYZER=english  # Text analyzer: english, chinese, standard, unicode, default (default english)
   ```

1. **Start Services**

   ```bash
   cd docker
   docker compose up -d
   ```

### Method 2: Local Development Environment

1. **Set Environment Variables**

   Before running Dify API, set the following environment variables:

   ```bash
   export VECTOR_STORE=doris
   export DORIS_HOST=localhost
   export DORIS_PORT=9030
   export DORIS_USER=root
   export DORIS_PASSWORD=your-password
   export DORIS_DATABASE=dify
   export DORIS_STREAMLOAD_PORT=8030
   ```

   Or set them in a `.env` file (if using python-dotenv)

1. **Run API Service**

   ```bash
   cd api
   uv run --project api flask run
   ```

## Verify Configuration

### 1. Check Doris Connection

Connect to Doris using MySQL client:

```bash
mysql -h your-doris-host -P 9030 -u root -p
```

### 2. Test Doris HTTP Endpoint

Check if Doris FE HTTP endpoint is accessible:

```bash
curl http://your-doris-host:8030/api/v1/health
```

### 3. Create Dataset in Dify

1. Login to Dify Web interface
1. Create a new dataset
1. Upload documents for indexing
1. Check if corresponding tables are created in Doris database:
   ```sql
   USE dify;
   SHOW TABLES LIKE 'embedding_%';
   ```

## Features

Doris Vector Store supports the following features:

- ✅ **Vector Similarity Search**: Semantic search using `cosine_distance`
- ✅ **Full-text Search**: Keyword search using `MATCH_ANY` and BM25 scoring
- ✅ **Hybrid Search**: Supports both vector search and text search simultaneously
- ✅ **StreamLoad Batch Import**: High-performance bulk data loading
- ✅ **Connection Pool Management**: Automatic database connection management

## Troubleshooting

### Issue: Connection Failed

**Check:**

1. Is Doris FE running?
1. Are ports correct (MySQL: 9030, HTTP: 8030)?
1. Are username and password correct?
1. Does firewall allow the connection?

### Issue: StreamLoad Failed

**Check:**

1. Is Doris HTTP port (8030) accessible?
1. Does the user have StreamLoad permissions?
1. Check error messages in Doris FE logs

### Issue: Table Creation Failed

**Check:**

1. Does the database exist?
1. Does the user have CREATE TABLE permissions?
1. Check error messages in Doris logs

## Performance Optimization Recommendations

1. **Adjust Connection Pool Size**

   - Adjust `DORIS_MAX_CONNECTION` based on concurrent request volume
   - Recommended value: concurrent requests + 2

1. **Text Analyzer Selection**

   - English content: use `english`
   - Chinese content: use `chinese`
   - Multilingual: use `standard`

1. **Batch Insertion**

   - StreamLoad automatically processes data in batches
   - Recommended: 100-1000 records per insertion

## Reference Documentation

- [Apache Doris Official Documentation](https://doris.apache.org/)
- [Doris Vector Search Documentation](https://doris.apache.org/docs/latest/ai/vector-search/overview)
- [Doris Text Search Documentation](https://doris.apache.org/docs/latest/ai/text-search/overview)
- [Doris StreamLoad Documentation](https://doris.apache.org/docs/data-operate/import/stream-load-manual)
