# nuqs-jotai

Dify's URL atoms. `atomWithSearchParam` and `atomWithSearchParams` accept nuqs parsers, but the runtime does not
use nuqs hooks, queues, or internal APIs. One `QueryStateProvider` owns the URL
snapshot and commit queue for all query definitions beneath it. Definitions need
no registration or per-page bridge.

## Usage

Dify mounts its app `QueryStateProvider` once in the root layout, beneath the
application Jotai provider. It supplies the Next/Vinext adapter to the package
provider. Features declare atoms independently:

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
and query caches remain visible. Existing business scopes still reset page-local
workflows when a knowledge space or document changes.

## Commit rules

- URL writes batch within a task, with optional debounce. An immediate action
  includes the current pending draft, even across different query definitions.
  A filter push commits the current search too and creates one history entry.
- In a batch, `push`, `shallow: false`, and `scroll: true` take precedence. The
  browser adapter leaves a conservative 400ms interval between provider writes.
  Atom state updates immediately while the URL commit waits.
- Commits merge changed keys into the latest browser URL. Unknown parameters and
  the hash survive. Unrelated history writes retain pending drafts.
- Back/forward, changes to a pending configuration's URL keys, or a different
  pathname cancel pending work. Dify also cancels when the router exposes a new
  pathname before browser history commits. A cancelled promise resolves with
  the current URL. Provider disposal prevents subsequent writes.
- The provider survives page changes. Page-owned async work must cancel on page
  disposal; a newly issued command is not an old queued command. Retrieval guards
  model-readiness, planning, and research creation continuations accordingly.
- Parse failures use defaults without rewriting the URL. Serialization completes
  before any state changes. A history failure reconciles to the actual address,
  rejects the write promise, and is exposed by the exported `queryStateErrorAtom`, scoped to the nearest provider.
- Promise completion means the address has been written, not that server data
  has finished loading. The Dify adapter writes history once, then calls
  `router.replace` inside a transition for non-shallow updates.

The browser observer defers history notifications to a microtask because routers
can update history from insertion effects. Popstate cancels synchronously. A
shared observer watches other history owners, including nuqs; provider disposal
removes its subscriptions.

Prefer codecs for parse defaults and user commands for changes rather than
normalizing URL state in descendant mount effects. Jotai 3's default React
subscription is passive and can miss a value changed between initial render and
subscription.

## Scope and verification

Supports Dify's current parsers, `urlKeys`, defaults, `clearOnDefault`,
push/replace, scroll, shallow routing and debounce/throttle. It does not implement
all nuqs options, including per-write `startTransition`, `processUrlSearchParams`,
or dynamic provider configuration. Keep nuqs parsers/types as a compatibility
dependency. Documents uses atoms for search, status, upload, and metadata; other
Dify routes outside this migration continue using nuqs.

Run `pnpm --filter nuqs-jotai test run` and
`pnpm --filter nuqs-jotai type-check` from the repository root. Memory tests cover
history and queue behavior; React tests cover first render, SSR, scopes,
StrictMode, and writes without value subscribers. Browser-adapter unit tests
exercise history and route-refresh callbacks. Running-app navigation and server
refresh still require Next/Vinext integration validation.
