# Contracts

## How to Improve Readiness

Improve the ready percentage by fixing the backend annotations that produce loose generated types, then regenerating the contracts.

- Add accurate request body schemas for endpoints that currently generate loose object types.
- Add accurate 2xx response schemas for endpoints that return JSON payloads.
- Use 204 responses for endpoints that intentionally return no body.
- Avoid untyped dictionaries, raw objects, or `additionalProperties: true` responses unless the API really returns an arbitrary object.
- Regenerate with `pnpm -C packages/contracts gen-api-contract` and check the terminal output for the current counts.

Do not remove the generated warning just to increase the number. The warning should disappear because the backend OpenAPI output became accurate enough for callers to migrate safely.
