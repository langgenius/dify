#!/bin/bash

set -x

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
cd "$SCRIPT_DIR/.."


uv --directory api run \
  flask run --host 0.0.0.0 --port=5001 --debug
