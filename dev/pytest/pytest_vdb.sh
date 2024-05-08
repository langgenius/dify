#!/bin/bash
set -x

docker ps

curl localhost:9200/_cat/health

curl 127.0.0.1:9200/_cat/health

pytest api/tests/integration_tests/vdb/elasticsearch
