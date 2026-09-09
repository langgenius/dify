# nuqs-jotai

Dify's URL atoms. `atomWithSearchParam` and `atomWithSearchParams` accept nuqs parsers, but the runtime does not
use nuqs hooks, queues, or internal APIs. One `QueryStateProvider` owns the URL
snapshot and commit queue for all query definitions beneath it. Definitions need
no registration or per-page bridge.

## Usage

Mount `QueryStateProvider` once beneath the application Jotai provider and pass
a stable `QueryAdapter`. The browser adapter is available from
`nuqs-jotai/browser`; memory and React testing adapters are available from
`nuqs-jotai/testing`. Application routing integration is supplied by the consumer.
Features declare atoms independently:

```tsx
const searchAtom = atomWithSearchParam('query', parseAsString.withDefault(''), {
  limitUrlUpdates: debounce(300),
})

function Search() {
  const [value, setValue] = useAtom(searchAtom)
  return <input value={value} onChange={(event) => void setValue(event.target.value)} />
}
```

Use `atomWithSearchParams` for related parameters that need composite patches:

```ts
const selectionAtom = atomWithSearchParams(
  {
    research: parseAsString,
    retest: parseAsString,
    trace: parseAsString,
  },
  { history: 'push' },
)

store.set(selectionAtom, { research: taskId, retest: null, trace: null })
```

For related parameters used by separate controls, return the field atoms directly:

```ts
const { search: searchAtom, filter: filterAtom } = atomsWithSearchParams(
  {
    search: parseAsString.withDefault(''),
    filter: parseAsString.withDefault('all'),
  },
  { urlKeys: { search: 'query', filter: 'status' } },
)
```

`atomWithSearchParam` and `atomWithSearchParams` return writable atoms;
`atomsWithSearchParams` returns a map of writable field atoms backed by one
composite atom. Field writes retain the whole group's owned URL keys for
navigation conflict detection and support functional updates, null resets, and
per-write options. `urlKeys` maps field names to URL parameter names. Options follow
provider defaults, parser settings, factory options, then per-write overrides.

Functional updates read the current
optimistic URL state. `null` resets a parameter, or all parameters in that
configuration for a composite write. Parser defaults are available on first
render, including SSR, and are omitted from the URL unless `clearOnDefault` is
false. The provider scopes only its runtime primitives; parent auth, permissions,
and query caches remain visible. Business scopes can independently reset
page-local workflows.

## Commit rules

- URL writes batch within a task, with optional debounce. An immediate action
  includes the current pending draft, even across different query definitions.
  A filter push commits the current search too and creates one history entry.
- `throttle(Infinity)` keeps optimistic state but disables URL writes and server
  refreshes, including an already scheduled batch. Its promise resolves with the
  current URL. A later finite-rate write can commit the retained draft.
- In a batch, `push`, `shallow: false`, and `scroll: true` take precedence. The
  browser adapter leaves a conservative 400ms interval between provider writes.
  Atom state updates immediately while the URL commit waits.
- Commits merge changed keys into the latest browser URL. Unknown parameters and
  the hash survive. Unrelated history writes retain pending drafts.
- Back/forward, changes to a pending configuration's URL keys, or a different
  pathname cancel pending work. Router integrations can call `notifyUrlChange(true)`
  to cancel when a new pathname is exposed before history commits. A cancelled promise resolves with
  the current URL. Provider disposal prevents subsequent writes.
- The provider survives page changes. Page-owned async work must cancel on page
  disposal; a newly issued command is not an old queued command. Guard async
  continuations before writing URL state after a page has unmounted.
- Parse failures use defaults without rewriting the URL. Serialization completes
  before any state changes. A history failure reconciles to the actual address,
  rejects the write promise, and is exposed by the exported `queryStateErrorAtom`, scoped to the nearest provider.
- Promise completion means the address has been written, not that server data
  has finished loading. The browser adapter writes history once, then invokes
  the supplied `refresh` callback for non-shallow updates.

The browser observer defers history notifications to a microtask because routers
can update history from insertion effects. Popstate cancels synchronously. A
shared observer watches other history owners, including nuqs; provider disposal
removes its subscriptions. Routers that bypass wrapped history methods must call
`notifyUrlChange()` after their URL commit. Use `notifyUrlChange(true)` when
the router announces a pathname change before history commits: it cancels queued
writes against the current address. Notify again after the destination URL has
committed to read the new address; ordinary commit notifications must not force
traversal, since they can reflect the provider's own writes. Publish route notifications after
child passive subscriptions have mounted so newly mounted Jotai consumers do not
miss the updated snapshot.

Prefer codecs for parse defaults and user commands for changes rather than
normalizing URL state in descendant mount effects. Jotai 3's default React
subscription is passive and can miss a value changed between initial render and
subscription.

## Scope and verification

Supports nuqs parsers, `urlKeys`, defaults, `clearOnDefault`,
push/replace, scroll, shallow routing and debounce/throttle. It does not implement
all nuqs options, including per-write `startTransition`, `processUrlSearchParams`,
or dynamic provider configuration. Keep nuqs parsers/types as a compatibility
dependency. This package does not mount a provider or migrate application pages.

Run `pnpm --filter nuqs-jotai test run` and
`pnpm --filter nuqs-jotai type-check` from the repository root. Memory tests cover
history and queue behavior; React tests cover first render, SSR, scopes,
StrictMode, and writes without value subscribers. Browser-adapter unit tests
exercise history and route-refresh callbacks. Running-app navigation and server
refresh still require Next/Vinext integration validation.
