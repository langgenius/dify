'use client'

import type { ReactNode } from 'react'
import type { SourceFilter } from './source-list-query-state'
import type { SourceSort } from './state'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import {
  sourcesAwaitedOperationIdAtom,
  sourcesFilterAtom,
  sourcesKnowledgeSpaceIdAtom,
  sourcesSearchAtom,
  sourcesSessionAtoms,
  sourcesSortAtom,
} from './state'

function SourcesExternalInputsBridge({
  awaitedOperationId,
  children,
  filter,
  search,
  sort,
}: {
  awaitedOperationId: string | null
  children: ReactNode
  filter: SourceFilter
  search: string
  sort: SourceSort
}) {
  useHydrateAtoms(
    [
      [sourcesFilterAtom, filter],
      [sourcesSearchAtom, search],
      [sourcesSortAtom, sort],
      [sourcesAwaitedOperationIdAtom, awaitedOperationId],
    ],
    { dangerouslyForceHydrate: true },
  )

  return children
}

export function SourcesStateBoundary({
  awaitedOperationId,
  children,
  filter,
  knowledgeSpaceId,
  search,
  sort,
}: {
  awaitedOperationId: string | null
  children: ReactNode
  filter: SourceFilter
  knowledgeSpaceId: string
  search: string
  sort: SourceSort
}) {
  return (
    <ScopeProvider
      key={knowledgeSpaceId}
      atoms={[
        [sourcesKnowledgeSpaceIdAtom, knowledgeSpaceId],
        [sourcesFilterAtom, filter],
        [sourcesSearchAtom, search],
        [sourcesSortAtom, sort],
        [sourcesAwaitedOperationIdAtom, awaitedOperationId],
        ...sourcesSessionAtoms,
      ]}
      name="SourcesPage"
    >
      <SourcesExternalInputsBridge
        awaitedOperationId={awaitedOperationId}
        filter={filter}
        search={search}
        sort={sort}
      >
        {children}
      </SourcesExternalInputsBridge>
    </ScopeProvider>
  )
}
