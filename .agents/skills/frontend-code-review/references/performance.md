# Rule Catalog — Performance

## React Flow data usage

IsUrgent: True
Category: Performance

### Description

When rendering React Flow, prefer `useNodes`/`useEdges` for UI consumption and rely on `useStoreApi` inside callbacks that mutate or read node/edge state. Avoid manually pulling Flow data outside of these hooks.

## Complex prop stability

IsUrgent: False
Category: Performance

### Description

Only require stable object, array, or map props when there is a clear reason: the child is memoized, the value participates in effect/query dependencies, the value is part of a stable-reference API contract, or profiling/local behavior shows avoidable re-renders. Do not request `useMemo` for every inline object by default; `how-to-write-component` treats memoization as a targeted optimization.

Update this file when adding, editing, or removing Performance rules so the catalog remains accurate.

Risky:

```tsx
<HeavyComp
    config={{
        provider: ...,
        detail: ...
    }}
/>
```

Better when stable identity matters:

```tsx
const config = useMemo(() => ({
    provider: ...,
    detail: ...
}), [provider, detail]);

<HeavyComp
    config={config}
/>
```
