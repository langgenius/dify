---
name: orpc-contract-first
description: Guide for implementing oRPC contract-first API patterns in Dify frontend. Triggers when creating new API contracts, adding service endpoints, integrating TanStack Query with typed contracts, or migrating legacy service calls to oRPC. Use for all API layer work in web/contract and web/service directories.
---

# oRPC Contract-First Development

Type-safe API contracts using oRPC with TanStack Query integration.

## Project Structure

```
web/
├── contract/
│   ├── base.ts              # Base contract with inputStructure: 'detailed'
│   ├── router.ts            # Router composition & type exports
│   ├── marketplace.ts       # Marketplace API contracts
│   └── console/             # Console API contracts (by domain)
│       ├── system.ts        # System-related contracts
│       └── billing.ts       # Billing-related contracts
└── service/
    ├── client.ts            # oRPC clients & query utilities
    └── use-*.ts             # TanStack Query hooks
```

**Key principles:**
- Group contracts by API prefix/domain in subdirectories (no barrel files)
- Import directly from specific files: `import { x } from './console/billing'`

## Step-by-Step Workflow

### 1. Define Contract

Create contract in appropriate domain file:

```typescript
// web/contract/console/billing.ts
import { type } from '@orpc/contract'
import { base } from '../base'

export const invoicesContract = base
  .route({
    path: '/billing/invoices',
    method: 'GET',
  })
  .input(type<unknown>())
  .output(type<{ url: string }>())

export const bindPartnerStackContract = base
  .route({
    path: '/billing/partners/{partnerKey}/tenants',
    method: 'PUT',
  })
  .input(type<{
    params: { partnerKey: string }
    body: { click_id: string }
  }>())
  .output(type<unknown>())
```

### 2. Register in Router (Nested Structure)

Group related contracts by API prefix:

```typescript
// web/contract/router.ts
import type { InferContractRouterInputs } from '@orpc/contract'
import { invoicesContract, bindPartnerStackContract } from './console/billing'
import { systemFeaturesContract } from './console/system'

export const consoleRouterContract = {
  systemFeatures: systemFeaturesContract,
  billing: {
    invoices: invoicesContract,
    bindPartnerStack: bindPartnerStackContract,
  },
}

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>
```

### 3. Use in Hooks

```typescript
// web/service/use-billing.ts
import { useQuery, useMutation } from '@tanstack/react-query'
import { consoleClient, consoleQuery } from '@/service/client'

export const useBillingUrl = (enabled: boolean) => {
  return useQuery({
    queryKey: consoleQuery.billing.invoices.queryKey(),
    enabled,
    queryFn: async () => {
      const res = await consoleClient.billing.invoices()
      return res.url
    },
  })
}

export const useBindPartnerStackInfo = () => {
  return useMutation({
    mutationKey: consoleQuery.billing.bindPartnerStack.mutationKey(),
    mutationFn: (data: { partnerKey: string, clickId: string }) =>
      consoleClient.billing.bindPartnerStack({
        params: { partnerKey: data.partnerKey },
        body: { click_id: data.clickId },
      }),
  })
}
```

## Contract Patterns

### Input Structure

Base uses `inputStructure: 'detailed'`:

```typescript
input(type<{
  params: { ... }   // Path parameters
  query?: { ... }   // Query string
  body?: { ... }    // Request body
}>())
```

### Path Parameters

Use `{paramName}` in path, match in `params`:

```typescript
.route({
  path: '/users/{userId}/posts/{postId}',
  method: 'GET',
})
.input(type<{
  params: { userId: string; postId: string }
}>())
```

### No Input Required

```typescript
.input(type<unknown>())
.output(type<SystemFeatures>())
```

## Router Nesting Best Practices

Group by API prefix for scalability:

```typescript
// Good - nested by prefix
export const consoleRouterContract = {
  system: { features: systemFeaturesContract },
  billing: {
    invoices: invoicesContract,
    subscription: subscriptionContract,
  },
  apps: { /* ... */ },
  datasets: { /* ... */ },
}

// Bad - flat structure
export const consoleRouterContract = {
  systemFeatures: systemFeaturesContract,
  billingInvoices: invoicesContract,
  billingSubscription: subscriptionContract,
}
```

**Call pattern:** `consoleClient.billing.invoices()` instead of `consoleClient.billingInvoices()`

## Adding New Domain

1. Create `web/contract/console/{domain}.ts`
2. Define contracts with proper input/output types
3. Add nested group in `router.ts`
4. Create `web/service/use-{domain}.ts` hooks

## Checklist

- [ ] Contract in `web/contract/console/{domain}.ts`
- [ ] Nested structure in `router.ts` (grouped by API prefix)
- [ ] Input types use detailed structure (params, query, body)
- [ ] Hooks use `consoleQuery.{group}.{contract}.queryKey()`
- [ ] Import types from `@/types/` (not inline)

## Common Mistakes

1. **Flat router structure** - Always nest by API prefix
2. **Missing `params` wrapper** - Path params must be in `params: { }`
3. **Barrel files** - Import directly from specific files
4. **Wrong query key** - Use `consoleQuery.billing.invoices.queryKey()` not manual keys
