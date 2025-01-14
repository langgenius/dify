#!/bin/bash

cd /workspaces/dify/web && npm install
cd /workspaces/dify/api && poetry env use 3.12 && poetry install
