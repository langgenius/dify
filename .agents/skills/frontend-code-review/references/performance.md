# Performance Review

Use [Runtime] for ownership, Effects, request concurrency, optional surfaces, and subscription rules. Use [Data and queries] for cache, SSR, authentication, and tenant boundaries. These references own the rules; this pack adds evidence questions.

## Establish The Cost

Report a reachable cost with a causal path, such as request ordering, bundle output, repeated expensive computation, or browser rendering evidence. A missing optimization alone is not a finding.

- For waterfalls, establish that the requests are independent and on the user-visible critical path. Preserve execution conditions and failure ownership when proposing concurrency or streaming.
- For eager imports, identify the module's cost and when the feature needs it. Check actual bundler behavior before treating a barrel import or dynamic path as a bundle regression.
- For server work, identify duplicated requests or serialized data and the request-local owner that can safely deduplicate them.
- For subscriptions and rendering, trace the changing value to the affected consumer before proposing narrower state, selectors, or memoization.
- For lists, layout, and motion, establish the supported data size or interaction and the rendering cost. Do not request virtualization, caching, or an animation rewrite solely because a particular API or CSS property appears.

## Distinguish Value And Reference Identity

- TanStack Query keys are hashed by value by default. Recreating an equivalent key or generated input/options object does not itself create a new query or justify `useMemo`; inspect the key's values and query policy. See [Query keys].
- Query `select` functions can recompute when their reference changes. Require a stable selector only when that recomputation has a demonstrated cost. The top-level query result is intentionally not referentially stable; read the fields the consumer needs. See [Query render optimizations].
- For React dependencies, memoized children, and library APIs, identify the specific consumer whose behavior or cost depends on reference identity. First check that an Effect belongs there; do not use memoization to hide an ownership or dependency problem.

[Data and queries]: data-query-contracts.md
[Query keys]: https://tanstack.com/query/latest/docs/framework/react/guides/query-keys
[Query render optimizations]: https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations
[Runtime]: ../../how-to-write-component/references/runtime.md
