# nuqs-jotai

URL search parameters as Jotai atoms, using nuqs parsers with an independent
commit queue. Mount one `QueryStateProvider` beneath the application Jotai
provider and supply a stable adapter. Atom definitions need no registration.

## Atoms

Use a single atom for one parameter:

```tsx
const searchAtom = atomWithSearchParam('query', parseAsString.withDefault(''), {
  limitUrlUpdates: debounce(300),
})

function Search() {
  const [value, setValue] = useAtom(searchAtom)
  return <input value={value} onChange={(event) => void setValue(event.target.value)} />
}
```

Use a composite atom to update related parameters together:

```ts
const selectionAtom = atomWithSearchParams(
  { research: parseAsString, retest: parseAsString, trace: parseAsString },
  { history: 'push' },
)

store.set(selectionAtom, { research: taskId, retest: null, trace: null })
```

Use a map of field atoms when separate controls share the same parameter group:

```ts
const { search: searchAtom, filter: filterAtom } = atomsWithSearchParams(
  { search: parseAsString.withDefault(''), filter: parseAsString.withDefault('all') },
  { urlKeys: { search: 'query', filter: 'status' } },
)
```

All three support functional updates and per-write options. Field writes retain
ownership of the whole group's URL keys for navigation conflict detection.
`null` removes a parameter (or the whole composite group), restoring parser
defaults. Defaults are omitted unless `clearOnDefault: false`. As in nuqs,
option precedence is provider defaults, factory options, parser settings, then
write options. Undefined options fall through to the next level.

Atoms addressing the same URL key share typed optimistic values and must use
compatible parsers (the same value type and encoding). Defaults may differ:
clearing a key restores each reader's own default. Local writes retain their
typed value even when serialization is lossy, such as an ISO date without a
time component. A fresh provider parses the committed URL. Unrelated URL
changes reuse each key's cached parsed value without invoking its parser again.

## Provider and routing

`QueryStateProvider` owns the URL snapshot, pending edits, and commit errors. It
scopes only these primitives; parent application atoms remain visible. Each
provider has an independent runtime. Its adapter and default options are fixed
for its lifetime. SSR reads use the adapter's initial URL.

The browser adapter is exported from `nuqs-jotai/browser`. Supply `initialUrl` and
a `refresh(url)` callback. Non-shallow writes call `refresh`, even when the URL
is unchanged; unchanged addresses do not add history entries. The browser
adapter observes native history methods and popstate. Routers that bypass those
methods must call `adapter.notifyUrlChange()` after committing their URL.

Call `adapter.notifyUrlChange(true)` to cancel drafts when a router announces a
pathname change before history commits, then notify normally after the commit.
Publish router notifications after child passive subscriptions have mounted.
The provider subscribes in a passive effect for the same reason: Jotai's default
React subscription can miss updates between render and subscription.

Hiding a provider cancels queued drafts; revealing it reconciles the current
URL. Unmounting rejects subsequent writes. Page-owned async commands must guard
against writing after their page unmounts, since an app provider can outlive it.

## Commits

- Atom values update optimistically, independently of URL serialization. URL
  writes ready in the same tick batch together. Debounce deadlines belong to
  individual URL keys; editing another key or using `history: 'push'` does not
  flush a pending debounce. A finite throttled write to the same key replaces
  its debounce and settles the superseded writes with that commit.
- Throttle uses the largest requested interval in the ready batch, measured
  from the preceding URL commit. A write after an idle interval can commit on
  the next tick. `push`, `shallow: false`, and `scroll: true` take precedence
  within a throttle batch; a restarted debounce uses its latest options.
- Composite patches publish all typed values together after successful
  serialization, but keys with different debounce deadlines may commit
  separately. Their write promise waits for all affected keys to settle. Use
  the same per-write rate limit for keys that should commit together.
- The browser adapter enforces a 400ms minimum interval between commits.
  `throttle(Infinity)` keeps the draft without writing or refreshing, resolves
  promises with the current URL, and lets a later finite-rate write resume it.
- Commits preserve unknown parameters and hashes. Traversal, pathname changes,
  or changes to a pending group's keys cancel drafts. Unrelated changes retain
  them. Cancelled promises resolve with the current URL.
- Parsing failures use defaults without rewriting the URL. Serialization
  completes before state changes. Write failures reconcile state, reject the
  promise, and update the provider-scoped `queryStateErrorAtom`.
- `startTransition` callbacks wrap the adapter commit, including non-shallow
  refreshes. A resolved write promise does not imply server data has finished
  loading.

## Scope and verification

Supports nuqs parsers, URL aliases, defaults, history, scroll, shallow routing,
transitions, and debounce/throttle. `processUrlSearchParams` and dynamic provider
options are not implemented. The scheduler is provider-local and uses the
adapter's minimum interval (400ms in the browser, zero in memory tests), rather
than nuqs's browser-detected global rate limit. Navigation conflict cancellation
is also owned by this package. Native arrays use `?key=` as the empty marker;
fresh string-array readers interpret that marker as `['']`, while a local write
of `[]` retains its typed value. This package does not introduce a different URL
encoding to resolve that ambiguity.

Memory and React adapters are exported from `nuqs-jotai/testing`. Run
`pnpm --filter nuqs-jotai test run` and `pnpm --filter nuqs-jotai type-check` from
the repository root. Tests cover runtime commits, browser callbacks, parser
round trips, provider isolation, SSR, StrictMode, Suspense, and Activity.
Shared consumer tests run against both nuqs and the atom bridge to verify typed
values, per-key caching, option precedence, scheduling, and transition callbacks.
Running-app Next/Vinext navigation and server refresh require integration
validation in the consuming application.
