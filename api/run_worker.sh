#!/bin/bash

docker run -d --name dify-worker --network host --pid host -v /root/workspace/dify/api/.env:/app/api/.env -v /root/workspace/dify/docker/volumes/app/storage:/app/api/storage -e MODE="worker" registry.cn-hangzhou.aliyuncs.com/kindlingx/dify-api:apo-1.0.0-9d88021