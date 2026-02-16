---
name: orpc-contract-first
description: Guide for implementing oRPC contract-first API patterns in Dify frontend. Triggers when creating new API contracts, adding service endpoints, integrating TanStack Query with typed contracts, or migrating legacy service calls to oRPC. Use for all API layer work in web/contract and web/service directories.
---

# oRPC Contract-First Development

## Project Structure

```
web/contract/
├── base.ts           # Base contract (inputStructure: 'detailed')
├── router.ts         # Router composition & type exports
├── marketplace.ts    # Marketplace contracts
└── console/          # Console contracts by domain
    ├── system.ts
    └── billing.ts
```

## Workflow

1. **Create contract** in `web/contract/console/{domain}.ts`
   - Import `base` from `../base` and `type` from `@orpc/contract`
   - Define route with `path`, `method`, `input`, `output`

2. **Register in router** at `web/contract/router.ts`
   - Import directly from domain file (no barrel files)
   - Nest by API prefix: `billing: { invoices, bindPartnerStack }`

3. **Create hooks** in `web/service/use-{domain}.ts`
   - Use `consoleQuery.{group}.{contract}.queryKey()` for query keys
   - Use `consoleClient.{group}.{contract}()` for API calls

## Key Rules

- **Input structure**: Always use `{ params, query?, body? }` format
- **Path params**: Use `{paramName}` in path, match in `params` object
- **Router nesting**: Group by API prefix (e.g., `/billing/*` → `billing: {}`)
- **No barrel files**: Import directly from specific files
- **Types**: Import from `@/types/`, use `type<T>()` helper

## Type Export

```typescript
export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
```
