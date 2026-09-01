'use client'

import type { ReactNode } from 'react'
import type { OverviewWindow } from './state'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useEffect } from 'react'
import { overviewKnowledgeSpaceIdAtom, overviewWindowAtom } from './state'

function OverviewWindowBridge({
  children,
  window,
}: {
  children: ReactNode
  window: OverviewWindow
}) {
  const currentWindow = useAtomValue(overviewWindowAtom)
  const setWindow = useSetAtom(overviewWindowAtom)

  useEffect(() => {
    if (currentWindow !== window) setWindow(window)
  }, [currentWindow, setWindow, window])

  return children
}

export function OverviewStateBoundary({
  children,
  knowledgeSpaceId,
  window,
}: {
  children: ReactNode
  knowledgeSpaceId: string
  window: OverviewWindow
}) {
  return (
    <ScopeProvider
      key={knowledgeSpaceId}
      atoms={[
        [overviewKnowledgeSpaceIdAtom, knowledgeSpaceId],
        [overviewWindowAtom, window],
      ]}
      name="KnowledgeOverview"
    >
      <OverviewWindowBridge window={window}>{children}</OverviewWindowBridge>
    </ScopeProvider>
  )
}
