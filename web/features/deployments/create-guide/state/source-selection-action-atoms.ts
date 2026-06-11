'use client'

import type { WorkflowSourceApp } from './types'
import { atom } from 'jotai'
import { selectedAppAtom } from './source-atoms'
import { resetDeploymentTargetOptionsAtom } from './target-atoms'
import { submissionUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'

export const selectSourceAppAtom = atom(null, (_get, set, app: WorkflowSourceApp) => {
  set(selectedAppAtom, app)
  set(resetDeploymentTargetOptionsAtom)
  set(submissionUnsupportedDslNodesAtom, [])
})
