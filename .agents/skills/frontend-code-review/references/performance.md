# Performance Rules

Review performance only where there is realistic impact. Do not request `memo`, `useMemo`, `useCallback`, virtualization, or caching as style preferences.

## Async Waterfalls

Flag:

- Awaiting remote feature flags or fetches before checking cheap synchronous conditions.
- Sequential awaits for independent operations.
- API routes or server components starting requests late when they could start early.
- Nested per-item fetches running serially when each item can fetch in parallel.
- Suspense boundaries that force the whole page to wait when a lower boundary could stream or isolate loading.

Prefer `Promise.all` for independent work and branch-local awaits for conditionally needed data.

## Bundle Size

Flag:

- Barrel imports from heavy libraries or `@langgenius/dify-ui`.
- Dynamic paths that prevent static trace analysis.
- Heavy components loaded eagerly when hidden behind a dialog, tab, command, or feature activation.
- Analytics, logging, editor, visualization, or third-party SDK code loaded before it is needed.
- Feature-local optional modules imported at top level only for rare flows.

Use direct imports and `next/dynamic` where the user-visible path benefits.

## Server Rendering

Flag:

- Request-specific mutable state stored at module scope in SSR/RSC paths.
- Large duplicate data serialized across RSC/client boundaries.
- Static I/O repeated per request when it could be hoisted safely.
- Cross-request cache without a bounded invalidation strategy.
- Server actions lacking API-route-equivalent auth checks.

Use request-scoped deduplication such as `React.cache()` when repeated server reads in one request are the problem.

## Re-rendering

Flag:

- Effects or subscriptions reading broad state when a derived boolean or narrower selector is enough.
- Components defined inside components.
- Derived rendering state stored in state/effects.
- Non-primitive default props recreated for memoized children.
- Expensive work recalculated on every render where it affects real interaction cost.
- High-frequency transient values stored in state when refs or CSS variables would avoid render loops.

Do not flag simple primitive expressions wrapped or not wrapped in `useMemo`; prefer no memo for simple work.

Require stable object/array/function identity only when:

- The child is memoized and identity affects renders.
- The value is an effect/query dependency.
- A library API requires stable references.
- Profiling or local behavior shows avoidable re-rendering.

## DOM, Lists, And Rendering

Flag:

- Layout reads in render (`getBoundingClientRect`, `offset*`, `scrollTop`).
- Interleaved DOM reads/writes that can cause layout thrashing.
- Large lists rendering without virtualization, pagination, or `content-visibility`.
- SVG/animation code animating expensive properties when transform/opacity would work.
- `transition-all`.
- Long-running non-critical browser work performed immediately instead of idle/deferred scheduling.

## React Flow

For workflow React Flow components, keep this Dify-specific rule:

- UI consumption should use React Flow hooks such as `useNodes` / `useEdges`.
- Callback-only reads or mutations can use `useStoreApi`.
- Node components under `web/app/components/workflow/nodes/[nodeName]/node.tsx` must not depend on workflow stores that are absent in RAG Pipe template rendering.
