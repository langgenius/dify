# nuqs-jotai

A Jotai projection of **nuqs-owned URL state**. Nuqs owns parsing, typed optimistic
values, URL serialization, throttling/debouncing, history, transitions, and router
integration. This package owns only scoped snapshots and atom commands.

## Define and register a group

`createQueryGroup` returns a composite `atom` and individual `fields` sharing one
nuqs hook and snapshot. Register the **group**, not its atoms, beneath the native
framework adapter. Use a one-field group for a single parameter.

```tsx
import { useAtomValueRawSync, useSetAtom } from 'jotai'
import { debounce, parseAsInteger, parseAsString } from 'nuqs'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { createQueryGroup, QueryStateProvider } from 'nuqs-jotai'

const filters = createQueryGroup(
  {
    search: parseAsString.withDefault('').withOptions({ limitUrlUpdates: debounce(300) }),
    page: parseAsInteger.withDefault(1),
  },
  { urlKeys: { search: 'query' } },
)

function Search() {
  const search = useAtomValueRawSync(filters.fields.search)
  const setSearch = useSetAtom(filters.fields.search)
  return <input value={search} onChange={(event) => void setSearch(event.target.value)} />
}

function App() {
  return (
    <NuqsAdapter>
      <QueryStateProvider groups={[filters]}>
        <Search />
      </QueryStateProvider>
    </NuqsAdapter>
  )
}
```

Keep group definitions and registration stable for the boundary's lifetime.
Register at the route or application boundary that owns their lifetime. Only the
bridge's snapshot and command primitives are scoped; parent application atoms
remain live. Do not explicitly scope the group's atoms in descendant feature
scopes. Unregistered reads and writes throw.

## Composite and field commands

Use the composite atom to patch related parameters together, or a field atom for
an individual update. Both write through the same nuqs setter:

```ts
await store.set(filters.atom, { search: 'hello', page: 1 })
await store.set(filters.fields.page, (page) => page + 1, { history: 'push' })
await store.set(filters.atom, null) // Clear the group and restore reader defaults.
```

Composite atoms accept partial updates or `null`; field atoms accept a value or
`null`. Both accept functional updates and per-write nuqs options. Field atoms
select individual values, so unrelated fields do not notify their subscribers.

**A group is the snapshot consistency boundary.** Define fields read together by
a derived atom or query in one group. A multi-field update then reaches that
group's derived subscribers as one complete snapshot. Independently created groups
publish separately: even one native nuqs write updating both keys can notify a
cross-group subscriber with `[newSearch, oldPage]` before the final pair.
Registering groups in the same provider does not merge them into a transaction.

Use ordinary `useSetAtom`, `store.set`, and write atoms for commands. The atom
snapshot reflects nuqs's next React render; a `get` immediately after `set` in the
same command need not read a new value. Functional updates are passed directly to
nuqs and follow its batching semantics. A write promise is nuqs's URL-commit
promise, not a React-render or server-render completion signal. Handle rejections
at the command owner.

## Read with Jotai's synchronous API

Use Jotai 3's `useAtomValueRawSync` for URL atoms **and derived atoms depending on
them**. It checks the snapshot on render and subscription, including the first
render after Activity reveal. Default `useAtomValue` / `useAtom` subscriptions do
not provide this check. This package does not wrap or rename Jotai's read APIs.

**Raw means async atoms return a Promise.** Resolve it with React's `use` beneath
Suspense, for example `use(useAtomValueRawSync(asyncResultAtom))`. Synchronous
subscriptions trade concurrent rendering for snapshot consistency. A URL write's
`startTransition` still delegates navigation to nuqs; it does not make these atom
subscriptions concurrent.

The bridge force-hydrates scoped external inputs during render. Jotai warns that
forced hydration can behave incorrectly during concurrent rendering. Scope
isolation does not remove that limitation: interrupted renders and framework
navigation with Suspense need application-level validation before migration.

## Native nuqs interoperability and lifecycle

Native `useQueryState` / `useQueryStates` consumers share nuqs's typed updates and
URL queues with these groups. Use compatible parsers for the same URL key, as
required by nuqs. Separate Jotai scopes do not create independent URL queues.
Provider defaults and `processUrlSearchParams` belong on the native NuqsAdapter.
Option precedence, native-array encoding, typed values, pending promises, and
navigation cancellation follow the installed nuqs version.

The bridge holds mount/reveal commands until nuqs subscribes, then forwards them
in a microtask after the effect pass so other groups and native readers can
subscribe first. Commands arriving while writes are buffered join the buffer in
order. Cleanup cancels stale drains; unmount rejects unforwarded commands and
saved writers throw. Commands already forwarded follow nuqs's lifetime behavior.
Attached writers refresh during commit before descendant layout effects, so
update-time layout commands use current adapter defaults and URL processing.

## Testing and migration

`QueryTestingAdapter` from `nuqs-jotai/testing` wraps the real NuqsTestingAdapter
and accepts its props plus `groups`. Use `hasMemory` to check committed URL state
and wrap React-driven writes in Testing Library `act`.

```tsx
<QueryTestingAdapter groups={[filters]} searchParams="query=hello" hasMemory>
  <Search />
</QueryTestingAdapter>
```

This private, unmerged package replaces its earlier atom factories with
`createQueryGroup`. Use `.atom` for composite access and `.fields` for individual
access, change provider `atoms` to `groups`, and replace `useQueryAtomValue` with
Jotai's `useAtomValueRawSync`. Replace `useQueryAtom` with separate
`useAtomValueRawSync` and `useSetAtom` calls.

Run `pnpm --filter nuqs-jotai test run` and
`pnpm --filter nuqs-jotai type-check`. Tests cover shared composite/field access,
native nuqs interoperability, mount/reveal subscriptions, typed snapshots, scope
interoperability, SSR, and shared behavior tests against native nuqs. Running-app
Next/Vinext navigation and server rendering require integration validation.
