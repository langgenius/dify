'use client'

import type { ReactNode } from 'react'
import type { RetrievalLinkedSelection, RetrievalLocationUpdate } from './inputs'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import { parseAsString, useQueryStates } from 'nuqs'
import { useMemo } from 'react'
import {
  retrievalKnowledgeSpaceIdAtom,
  retrievalLinkedSelectionAtom,
  retrievalLocationUpdateAtom,
} from './inputs'
import { retrievalScopedAtoms } from './scoped'

function RetrievalLocationBridge({
  children,
  selection,
  updateLocation,
}: {
  children: ReactNode
  selection: RetrievalLinkedSelection
  updateLocation: RetrievalLocationUpdate
}) {
  useHydrateAtoms(
    [
      [retrievalLinkedSelectionAtom, selection],
      [retrievalLocationUpdateAtom, { update: updateLocation }],
    ],
    { dangerouslyForceHydrate: true },
  )

  return children
}

export function RetrievalStateBoundary({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  const [selection, setSelection] = useQueryStates({
    research: parseAsString,
    retest: parseAsString,
    trace: parseAsString,
  })
  const updateLocation = useMemo<RetrievalLocationUpdate>(
    () => (nextSelection, options) => {
      void setSelection(nextSelection, options)
    },
    [setSelection],
  )

  return (
    <ScopeProvider
      key={knowledgeSpaceId}
      atoms={[
        [retrievalKnowledgeSpaceIdAtom, knowledgeSpaceId],
        [retrievalLinkedSelectionAtom, selection],
        [retrievalLocationUpdateAtom, { update: updateLocation }],
        ...retrievalScopedAtoms,
      ]}
      name="RetrievalTestPage"
    >
      <RetrievalLocationBridge selection={selection} updateLocation={updateLocation}>
        {children}
      </RetrievalLocationBridge>
    </ScopeProvider>
  )
}
