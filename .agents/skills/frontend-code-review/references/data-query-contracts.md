# Data, Query, And Contract Review

[Data and queries] owns generated-client, Query options, mutation/cache, imperative access, SSR, authentication, and tenant rules. [State ownership] owns URL state and persistence. Read only the reference needed by the diff; reading a shared reference does not activate its implementation skill.

## Generated Contracts And Query Conventions

Review explicit team conventions as contracts, including direct generated options, `skipToken` for missing required input, and shared cache policy. A lint rule may enforce part of a convention; neither a green lint result nor a suppression proves the full contract is satisfied.

- Establish whether the changed call belongs to a new or migrated surface and whether the generated operation is ready. Check deprecated markers, schema shape, and the real UI consumer before prescribing a migration.
- Distinguish a pass-through wrapper from a feature hook with actual orchestration. Check whether an independent execution condition or Promise composition justifies the documented query/mutation exception.
- Trace generated input and output types through their boundaries. Identify the exact DTO mirror, field widening, placeholder input, or lost intentional empty value when reporting a violation.
- Check whether a local mutation callback owns feature feedback or replaces shared invalidation, retry, or cache defaults. Match optimistic changes to the current list/detail owner.

## Imperative Access And SSR

- Check freshness, projection, retries, and the caller's execution condition separately against [Data and queries]. Trace Promise ownership to distinguish an awaited hard gate from soft prefetching with an explicit failure owner.
- For Server Components, identify who renders the data and who may revalidate it. Check dehydration, the same-key client consumer, error handling, and the intended Suspense/server-rendered-content contract when the diff changes streaming.
- For auth, setup, roles, branding, or availability, trace authoritative data and the loading/fallback path. A static redirect or placeholder value cannot stand in for a request-dependent decision.

## Tenant, URL, And Persistence Boundaries

- Trace the current workspace-switch flow and cache lifetime before reporting missing identity in a query key. Verify backend meaning before treating `workspace_id` and `tenant_id` as interchangeable.
- For URL and storage changes, identify whether the value is shareable navigation state, live app state, a one-shot signal, or a low-frequency preference. Apply [State ownership] to that category and verify its write/reset owner.

Report the violated rule and applicable scope or the concrete failing path. Do not invent runtime impact when the finding is a team-convention violation.

[Data and queries]: ../../how-to-write-component/references/data.md
[State ownership]: ../../how-to-write-component/references/state.md
