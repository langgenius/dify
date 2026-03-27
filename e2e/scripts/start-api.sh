#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_DIR="${ROOT_DIR}/api"

cd "${API_DIR}"

ENV_EXPORTS="$(
  uv run --project . python - <<'PY'
from dotenv import dotenv_values
from shlex import quote

for key, value in dotenv_values("tests/integration_tests/.env.example").items():
    if value is None:
        value = ""
    print(f"export {key}={quote(value)}")
PY
)"

eval "${ENV_EXPORTS}"
unset ENV_EXPORTS

export FLASK_APP=app.py

uv run --project . flask upgrade-db
exec uv run --project . flask run --host 127.0.0.1 --port 5001
