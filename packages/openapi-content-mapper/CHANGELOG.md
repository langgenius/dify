# Changelog

## 0.1.0-beta.0

Initial experimental release. Requires TypeScript 7.1.0-beta for native content mapping and Node.js 24+ for tooling.

- Import OpenAPI 3.0/3.1 YAML or JSON-backed `.openapi` documents with inferred request and response types.
- Import `.openapi-source` command descriptors to infer from backend-exported OpenAPI in memory, with compiler and bundler dependency tracking.
- Export only `api` and `query`, with statically tree-shakable namespaces and typed document context.
- Support explicit `x-client-path` operation names without changing HTTP serialization or per-operation sidecars.
- Integrate with Vite, Next.js Turbopack/Webpack and Node module hooks, preserving independent document transports and sidecars.
- Support local schema references, recursive types, JSON, explicit multipart alternatives, binary bodies and raw SSE responses.
- Preserve download filenames from Content-Disposition, JSON wire strings for binary-formatted response fields and require explicit media selection for non-default alternatives.
- Resolve API/query types lazily, omit redundant schema representations and cache serialized mapper results across compiler processes, with invalidation for document, implementation and sidecar changes.

- Add statically selected operation query defaults and typed error maps, with lazy error validators and Vite/Next sidecar tracking.

The beta API and compiler protocol may change between prereleases. See the README for supported scope and compatibility limits.
