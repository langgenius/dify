These generated compatibility contracts cover the three Builder lifecycle routes
added after the frozen legacy Console contracts: `POST` session `abandon`, `clear`,
and `fix-intents`. They are test inputs, outside the production contract exports.
Every legacy member remains checked alongside these three operations.

Regenerate from the repository root after installing the frozen workspace
dependencies. The shared generator config eagerly reads the ordinary exported
API specifications, so prepare that ignored input directory first:

```sh
uv run --project api api/dev/generate_swagger_specs.py --output-dir packages/contracts/openapi
uv run --project api api/dev/generate_fastopenapi_specs.py --output-dir packages/contracts/openapi
pnpm --filter @dify/contracts exec node scripts/generate-builder-lifecycle-compat.ts
```

These exports populate ignored OpenAPI inputs; they do not regenerate the frozen
legacy TypeScript contracts.

The script reads the backend's in-memory Console export, selects exactly these
three POST operations and their referenced schemas, and reuses the ordinary API
normalizer and generator plugins. Only Zod and oRPC files are needed: the type
audit compares their inferred request and response types. It also records both
generated files' hashes.

The fixture describes the exported schema. Runtime validation remains in the
backend: clear requires the strict boolean `confirmed` to be true, and Fix intent
requires exactly one failed-run or checklist source. These model validators are
not expressed by the current OpenAPI schema. `expected_task_id` is a concurrency
guard; actor ownership and permission checks remain server responsibilities.

Fix intent's Session response has a parsed-versus-wire difference: action labels
can omit `BuilderCopy.type` or `BuilderTextParts.type` on the wire, while Zod fills
their `copy` or `parts` defaults in parsed output. Both wire-output directions and
every existing field-level check remain active.
