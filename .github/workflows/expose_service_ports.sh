#!/bin/bash

yq eval '.services.weaviate.ports += ["8080:8080"]' -i docker/docker-compose.yaml
yq eval '.services.qdrant.ports += ["6333:6333"]' -i docker/docker-compose.yaml
yq eval '.services.chroma.ports += ["8000:8000"]' -i docker/docker-compose.yaml
yq eval '.services["milvus-standalone"].ports += ["19530:19530"]' -i docker/docker-compose.yaml
yq eval '.services.pgvector.ports += ["5433:5432"]' -i docker/docker-compose.yaml
yq eval '.services["pgvecto-rs"].ports += ["5431:5432"]' -i docker/docker-compose.yaml
yq eval '.services["elasticsearch"].ports += ["9200:9200"]' -i docker/docker-compose.yaml

echo "Ports exposed for sandbox, weaviate, qdrant, chroma, milvus, pgvector, pgvecto-rs, elasticsearch"