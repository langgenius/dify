'use client'

import type { GuideMethod } from './types'
import { atom } from 'jotai'
import { resetDeploymentTargetOptionsAtom } from './target-atoms'
import { submissionUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'
import {
  methodAtom,
  stepAtom,
} from './workflow-atoms'

export const selectMethodAtom = atom(null, (_get, set, method: GuideMethod) => {
  set(methodAtom, method)
  set(resetDeploymentTargetOptionsAtom)
  set(submissionUnsupportedDslNodesAtom, [])
  set(stepAtom, 'source')
})
