---
name: frontend-query-mutation
description: Guide for implementing Dify frontend query and mutation patterns with TanStack Query and oRPC. Trigger when creating or updating contracts in web/contract, wiring router composition, consuming consoleQuery or marketplaceQuery in components or services, deciding whether to call queryOptions() directly or extract a helper or use-* hook, handling conditional queries, cache invalidation, mutation error handling, or migrating legacy service calls to contract-first query and mutation helpers.
---

# Frontend Query & Mutation

## Intent

- Keep contract as the single source of truth in `web/contract/*`.
- Prefer contract-shaped `queryOptions()` and `mutationOptions()`.
- Keep invalidation and mutation flow knowledge in the service layer.
- Keep abstractions minimal to preserve TypeScript inference.

## Workflow

1. Identify the change surface.
   - Read `references/contract-patterns.md` for contract files, router composition, client helpers, and query or mutation call-site shape.
   - Read `references/runtime-rules.md` for conditional queries, invalidation, error handling, and legacy migrations.
   - Read both references when a task spans contract shape and runtime behavior.
2. Implement the smallest abstraction that fits the task.
   - Default to direct `useQuery(...)` or `useMutation(...)` calls with oRPC helpers at the call site.
   - Extract a small shared query helper only when multiple call sites share the same extra options.
   - Create `web/service/use-{domain}.ts` only for orchestration or shared domain behavior.
3. Preserve Dify conventions.
   - Keep contract inputs in `{ params, query?, body? }` shape.
   - Bind invalidation in the service-layer mutation definition.
   - Prefer `mutate(...)`; use `mutateAsync(...)` only when Promise semantics are required.

## Files Commonly Touched

- `web/contract/console/*.ts`
- `web/contract/marketplace.ts`
- `web/contract/router.ts`
- `web/service/client.ts`
- `web/service/use-*.ts`
- component and hook call sites using `consoleQuery` or `marketplaceQuery`

## References

- Use `references/contract-patterns.md` for contract shape, router registration, query and mutation helpers, and anti-patterns that degrade inference.
- Use `references/runtime-rules.md` for conditional queries, invalidation, `mutate` versus `mutateAsync`, and legacy migration rules.

Treat this skill as the single query and mutation entry point for Dify frontend work. Keep detailed rules in the reference files instead of duplicating them in project docs.
