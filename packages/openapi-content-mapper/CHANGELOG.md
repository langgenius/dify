# Changelog

## 0.1.0-beta.0

Initial experimental release. Requires TypeScript 7.1.0-beta for native content mapping and Node.js 24+ for tooling.

- Import OpenAPI 3.0/3.1 YAML or JSON-backed `.openapi` documents with inferred request and response types.
- Export only `api` and `query`, with statically tree-shakable namespaces and typed document context.
- Integrate with Vite, Next.js Turbopack/Webpack and Node module hooks.
- Support local schema references, recursive types, JSON, explicit multipart alternatives, binary bodies and raw SSE responses.
- Preserve JSON wire strings for binary-formatted response fields and require explicit media selection for non-default alternatives.
- Resolve API/query types lazily, omit redundant schema representations and cache serialized mapper results across compiler processes, with invalidation for document, implementation and sidecar changes.

The beta API and compiler protocol may change between prereleases. See the README for supported scope and compatibility limits.
