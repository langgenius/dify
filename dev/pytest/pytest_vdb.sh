#!/bin/bash
set -x

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/../.."

PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-180}"

uv sync --project api --group dev --group vdb-all

uv run --project api pytest --timeout "${PYTEST_TIMEOUT}" \
  api/providers/vdb/chroma/tests \
  api/providers/vdb/milvus/tests \
  api/providers/vdb/pgvecto-rs/tests \
  api/providers/vdb/pgvector/tests \
  api/providers/vdb/qdrant/tests \
  api/providers/vdb/weaviate/tests \
  api/providers/vdb/elasticsearch/tests \
  api/providers/vdb/vikingdb/tests \
  api/providers/vdb/baidu/tests \
  api/providers/vdb/tencent/tests \
  api/providers/vdb/upstash/tests \
  api/providers/vdb/couchbase/tests \
  api/providers/vdb/oceanbase/tests \
  api/providers/vdb/tidb-vector/tests \
  api/providers/vdb/huawei-cloud/tests \
  api/providers/vdb/hologres/tests \
