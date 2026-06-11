'use client'

import type { WorkflowSourceApp } from './types'
import type { App } from '@/types/app'
import { atom } from 'jotai'
import { isWorkflowApp } from '@/features/deployments/app-mode'
import { resetDeploymentTargetOptionsAtom } from './target-atoms'
import { clearCreateDeploymentGuideUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'

export const sourceSearchTextAtom = atom('')
export const selectedAppAtom = atom<WorkflowSourceApp | undefined>(undefined)

export const setSourceSearchTextAtom = atom(null, (_get, set, sourceSearchText: string) => {
  set(sourceSearchTextAtom, sourceSearchText)
})

export const selectSourceAppAtom = atom(null, (_get, set, app: App) => {
  if (!isWorkflowApp(app))
    return

  set(selectedAppAtom, app)
  set(resetDeploymentTargetOptionsAtom)
  set(clearCreateDeploymentGuideUnsupportedDslNodesAtom)
})
