#!/usr/bin/env bash
# Regenerate TypeScript types from the API swagger spec.
# Run from the cli/ directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_DIR="$(cd "$CLI_DIR/../api" && pwd)"

echo "→ Generating openapi swagger spec…"
(cd "$API_DIR" && uv run --project . dev/generate_swagger_specs.py)

echo "→ Generating TypeScript types…"
npx swagger-typescript-api generate \
    --path "$API_DIR/openapi/openapi-swagger.json" \
    --output "$CLI_DIR/src/types" \
    --modular \
    --no-client

echo "→ Fixing generated style…"
sed -i.bak '/\/\/ @ts-nocheck/d' "$CLI_DIR/src/types/data-contracts.ts"
sed -i.bak '1s|^/\* eslint-disable \*/|/* eslint-disable erasable-syntax-only/enums, ts\/no-explicit-any */|' "$CLI_DIR/src/types/data-contracts.ts"
rm -f "$CLI_DIR/src/types/data-contracts.ts.bak"

pnpm --filter @langgenius/difyctl lint:fix src/types/data-contracts.ts

rm -f "$API_DIR/openapi/"*-swagger.json

echo "✓ src/types/ updated"
