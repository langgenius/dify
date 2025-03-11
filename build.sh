#!/usr/bin/env bash
#export PATH=/usr/bin:$PATH

DIR=$(cd $(dirname $0); pwd)

cd $DIR/api
docker build -t dify-api-local:1.0.0 .

cd $DIR/web
docker build -t dify-web-local:1.0.0 .

cd $DIR/docker
docker-compose up -d api worker web
# docker-compose up -d

echo done
