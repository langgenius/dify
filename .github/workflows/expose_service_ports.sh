#!/bin/bash

yq eval '.services.weaviate.ports += ["8080:8080"]' -i docker/docker-compose.yaml
yq eval '.services.qdrant.ports += ["6333:6333"]' -i docker/docker-compose.yaml
yq eval '.services.chroma.ports += ["8000:8000"]' -i docker/docker-compose.yaml
yq eval '.services["milvus-standalone"].ports += ["19530:19530"]' -i docker/docker-compose.yaml
yq eval '.services.pgvector.ports += ["5433:5432"]' -i docker/docker-compose.yaml
yq eval '.services["pgvecto-rs"].ports += ["5431:5432"]' -i docker/docker-compose.yaml
yq eval '.services["elasticsearch"].ports += ["9200:9200"]' -i docker/docker-compose.yaml
yq eval '.services.couchbase-server.ports += ["8091-8096:8091-8096"]' -i docker/docker-compose.yaml
yq eval '.services.couchbase-server.ports += ["11210:11210"]' -i docker/docker-compose.yaml
yq eval '.services.tidb.ports += ["4000:4000"]' -i docker/tidb/docker-compose.yaml
yq eval '.services.oceanbase.ports += ["2881:2881"]' -i docker/docker-compose.yaml
yq eval '.services.opengauss.ports += ["6600:6600"]' -i docker/docker-compose.yaml

echo "Ports exposed for sandbox, weaviate, tidb, qdrant, chroma, milvus, pgvector, pgvecto-rs, elasticsearch, couchbase, opengauss"
