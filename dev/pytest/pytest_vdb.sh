#!/bin/bash
set -x

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/../.."

PYTEST_TIMEOUT="${PYTEST_TIMEOUT:-180}"

pytest --timeout "${PYTEST_TIMEOUT}" api/packages/dify-vdb-chroma/tests \
  api/packages/dify-vdb-milvus/tests \
  api/packages/dify-vdb-pgvecto-rs/tests \
  api/packages/dify-vdb-pgvector/tests \
  api/packages/dify-vdb-qdrant/tests \
  api/packages/dify-vdb-weaviate/tests \
  api/packages/dify-vdb-elasticsearch/tests \
  api/packages/dify-vdb-vikingdb/tests \
  api/packages/dify-vdb-baidu/tests \
  api/packages/dify-vdb-tencent/tests \
  api/packages/dify-vdb-upstash/tests \
  api/packages/dify-vdb-couchbase/tests \
  api/packages/dify-vdb-oceanbase/tests \
  api/packages/dify-vdb-tidb-vector/tests \
  api/packages/dify-vdb-huawei-cloud/tests \
  api/packages/dify-vdb-hologres/tests \
