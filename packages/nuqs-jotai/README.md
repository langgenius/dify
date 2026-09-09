# nuqs-jotai

A Jotai projection of **nuqs-owned URL state**. Nuqs owns parsing, typed optimistic
values, URL serialization, throttling/debouncing, history, transitions, and router
integration. This package owns only scoped snapshots and atom commands. It has no
URL scheduler, browser history patch, or independent navigation policy.

## Register atoms beneath your framework adapter

```tsx
import { useSetAtom } from 'jotai'
import { parseAsString, debounce } from 'nuqs'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { atomWithSearchParam, QueryStateProvider, useQueryAtomValue } from 'nuqs-jotai'

const searchAtom = atomWithSearchParam('query', parseAsString.withDefault(''), {
  limitUrlUpdates: debounce(300),
})
const urlAtoms = [searchAtom]

function Search() {
  const search = useQueryAtomValue(searchAtom)
  const setSearch = useSetAtom(searchAtom)
  return <input value={search} onChange={(event) => void setSearch(event.target.value)} />
}

function App() {
  return (
    <NuqsAdapter>
      <QueryStateProvider atoms={urlAtoms}>
        <Search />
      </QueryStateProvider>
    </NuqsAdapter>
  )
}
```

Keep atom definitions and registration stable for the boundary's lifetime. Register
at the route or application boundary that owns their lifetime. This boundary must
be inside the appropriate **native NuqsAdapter**, not a second browser adapter.
An existing application Jotai Provider may remain above it. Only the bridge's
snapshot and command primitives are scoped; parent application atoms remain live.
Do not explicitly scope query atoms in descendant feature scopes.

Native `useQueryState` / `useQueryStates` consumers can coexist with these atoms.
They share nuqs's typed updates and URL queues, including updates to different
keys in the same event. Use compatible parsers for readers of the same URL key,
as required by nuqs. Separate Jotai scopes do not create independent URL queues.

## React reads and atom commands

Use `useQueryAtomValue` for URL atoms **and derived atoms depending on them**. It
uses Jotai 3's public `useAtomValueRawSync` API so reads check the current snapshot
on render and subscription, including the first render after Activity reveal.
Jotai 3's default `useAtomValue` / `useAtom` subscription does not provide this
check; use `useQueryAtom(atom)` for the combined value/setter form instead.

These hooks retain the **Raw** API's semantics: an async derived atom returns a
Promise, not its resolved value. Consume it with React's `use` beneath Suspense,
for example `use(useQueryAtomValue(asyncResultAtom))`. Synchronous subscriptions
also trade concurrent rendering for snapshot consistency. Passing `startTransition`
to a URL write still delegates navigation to nuqs; it does not make these atom
subscriptions concurrent.

The bridge force-hydrates its scoped external inputs during render. Jotai warns
that forced hydration can behave incorrectly during concurrent rendering. Scope
isolation does not remove that limitation: interrupted renders and framework
navigation with Suspense need application-level validation before migration.

Use ordinary `useSetAtom`, `store.set`, and write atoms for commands. Writes are
forwarded to nuqs; the atom snapshot reflects nuqs's next React render. Do not
expect a `get` immediately following `set` in the same command to read a new
snapshot. Functional updates are passed directly to nuqs and follow its batching
semantics. A write promise is nuqs's URL-commit promise, not a React-render or
server-render completion signal. Handle write rejections at the command owner.

The bridge holds mount/reveal commands until nuqs's subscriptions are attached,
then forwards them unchanged in a microtask after the current effect pass. This
allows other registered groups and native readers in that pass to subscribe before
receiving typed updates. Commands arriving while a binding has buffered writes
join that buffer in order. Cleanup cancels that connection's pending drain;
unmount rejects any unforwarded commands. The bridge does not parse, normalize or
schedule URL commits itself. Saved writers throw after the bridge unmounts.
Commands already forwarded to nuqs follow nuqs's lifetime and cancellation behavior.

For an already attached bridge, the writer is refreshed during the commit before
layout effects run. Layout commands therefore use the current adapter defaults
and URL processing callback after an update. This does not attach a mount/reveal
connection before nuqs's subscriptions are ready.

## Composite groups and field atoms

```tsx
const selectionAtom = atomWithSearchParams(
  { research: parseAsString, retest: parseAsString, trace: parseAsString },
  { history: 'push' },
)

const filters = atomsWithSearchParams(
  { search: parseAsString.withDefault(''), page: parseAsInteger.withDefault(1) },
  { urlKeys: { search: 'query' } },
)

const urlAtoms = [selectionAtom, filters.search, filters.page]
```

Registering multiple fields from one factory creates only one nuqs hook for that
group. Register every independently created group you read or write. Unregistered
reads and writes throw rather than returning a misleading default.

Composite atoms accept partial updates or `null` to clear the group. All factories
accept functional updates, parser options, URL aliases, and per-write options.
Field atoms select individual values so unrelated fields retain their identity and
do not notify their subscribers.

**A group is the snapshot consistency boundary.** Define fields read together by
a derived atom or query with one `atomsWithSearchParams` or
`atomWithSearchParams` call. Each group publishes one snapshot, so a multi-field
update observed by that group reaches its derived subscribers as one complete
value. Independently created groups publish separately: even one native nuqs
write updating both keys can notify a cross-group subscriber with an intermediate
combination such as `[newSearch, oldPage]` before the final pair. React batching
does not make these separate Jotai store writes atomic. Registering independent
atoms in the same provider does not merge them into a group.

Provider defaults and `processUrlSearchParams` belong on the native NuqsAdapter.
Defaults, option precedence, native-array encoding, typed value retention, pending
promises, and navigation cancellation all follow the installed nuqs version. For
example, `parseAsNativeArrayOf(parseAsString)` cannot distinguish an empty array
from an empty string in the committed URL; nuqs may normalize `[]` to `['']` after
committing `?key=`. The bridge does not override that behavior.

## Testing

`QueryTestingAdapter` from `nuqs-jotai/testing` wraps the real NuqsTestingAdapter
and accepts its props plus `atoms`. Use `hasMemory` when checking committed URL
state. Wrap React-driven writes in Testing Library `act`.

```tsx
<QueryTestingAdapter atoms={urlAtoms} searchParams="query=hello" hasMemory>
  <Search />
</QueryTestingAdapter>
```

Run `pnpm --filter nuqs-jotai test run` and
`pnpm --filter nuqs-jotai type-check`. Tests cover native nuqs interoperability,
mount/reveal subscriptions, typed snapshots, scope interoperability, SSR, and
shared behavior tests against native nuqs. Framework-specific behavior is delegated
to the installed adapter rather than emulated by the package.
