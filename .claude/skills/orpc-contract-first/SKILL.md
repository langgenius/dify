---
name: orpc-contract-first
description: Guide for implementing oRPC contract-first API patterns in Dify frontend. Triggers when creating new API contracts, adding service endpoints, integrating TanStack Query with typed contracts, or migrating legacy service calls to oRPC. Use for all API layer work in web/contract and web/service directories.
---

# oRPC Contract-First Development

This skill provides guidance for implementing type-safe API contracts using oRPC with TanStack Query integration.

## Core Concepts

**Contract-First**: Define API contracts before implementation. Contracts are the single source of truth for:
- Route paths and methods
- Input/output types
- Type inference across client and server

## Project Structure

```
web/
├── contract/           # API contracts
│   ├── base.ts         # Base contract with inputStructure
│   ├── console.ts      # Console API contracts
│   ├── marketplace.ts  # Marketplace API contracts
│   └── router.ts       # Router composition & type exports
└── service/
    ├── client.ts       # oRPC clients & query utilities
    └── use-*.ts        # TanStack Query hooks
```

## Step-by-Step Workflow

### 1. Define Contract

Create or extend a contract file in `web/contract/`:

```typescript
// web/contract/{domain}.ts
import { type } from '@orpc/contract'
import { base } from './base'

// GET request - simple
export const getItemContract = base
  .route({
    path: '/items/{id}',
    method: 'GET',
  })
  .input(type<{
    params: { id: string }
    query?: { include?: string }
  }>())
  .output(type<ItemResponse>())

// POST request with body
export const createItemContract = base
  .route({
    path: '/items',
    method: 'POST',
  })
  .input(type<{
    body: CreateItemRequest
  }>())
  .output(type<ItemResponse>())
```

### 2. Register in Router

Add contract to the appropriate router in `web/contract/router.ts`:

```typescript
import { getItemContract, createItemContract } from './{domain}'

export const consoleRouterContract = {
  // ... existing contracts
  getItem: getItemContract,
  createItem: createItemContract,
}
```

### 3. Use Query Utilities

Access type-safe query utilities via the generated client:

```typescript
// In hooks or components
import { consoleQuery } from '@/service/client'
import type { ConsoleInputs } from '@/contract/router'

// Query key generation (for TanStack Query)
const queryKey = consoleQuery.getItem.queryKey({
  input: { params: { id: '123' } }
})

// Type inference for inputs
type GetItemInput = ConsoleInputs['getItem']
```

### 4. Create React Hooks

```typescript
// web/service/use-{domain}.ts
import { useQuery, useMutation } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import type { ConsoleInputs } from '@/contract/router'

export function useItem(id: string) {
  return useQuery({
    queryKey: consoleQuery.getItem.queryKey({ 
      input: { params: { id } } 
    }),
    queryFn: ({ signal }) => fetchItem(id, { signal }),
  })
}
```

## Contract Patterns

### Input Structure

The base contract uses `inputStructure: 'detailed'`, requiring explicit structure:

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

### Optional Inputs

For endpoints with no required input:

```typescript
.input(type<unknown>())
.output(type<SystemFeatures>())
```

## Type Inference

Export router input types for external use:

```typescript
// web/contract/router.ts
import type { InferContractRouterInputs } from '@orpc/contract'

export type ConsoleInputs = InferContractRouterInputs<typeof consoleRouterContract>

// Usage: ConsoleInputs['getItem']['params']
```

## Server-Side Hydration

For SSR prefetching with Next.js:

```typescript
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { getQueryClientServer } from '@/context/query-client-server'
import { consoleQuery } from '@/service/client'

async function getDehydratedState() {
  const queryClient = getQueryClientServer()
  
  await queryClient.prefetchQuery({
    queryKey: consoleQuery.getItem.queryKey({ input: { params: { id } } }),
    queryFn: () => fetchItem(id),
  })
  
  return dehydrate(queryClient)
}
```

## Checklist for New Contracts

- [ ] Contract file created/updated in `web/contract/`
- [ ] Input types match API spec (params, query, body)
- [ ] Output types match response schema
- [ ] Contract registered in `router.ts`
- [ ] Query utilities exported from `web/service/client.ts`
- [ ] React hooks created in `web/service/use-{domain}.ts`
- [ ] Import types from `@/contract/router` (not inline)

## Common Mistakes

1. **Missing `params` wrapper** - Path params must be in `params: { }`
2. **Wrong input structure** - Always use detailed structure with explicit `params`, `query`, `body`
3. **Not using query utilities** - Always use `{router}Query.{contract}.queryKey()` for cache consistency
4. **Inline types** - Prefer importing shared types from `@/types/`
