'use client'

import type { GuideMethod, GuideStep } from '../types'
import { atom } from 'jotai'
import { resetDeploymentTargetOptionsAtom } from './target-atoms'
import { clearCreateDeploymentGuideUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'

export const stepAtom = atom<GuideStep>('source')
export const methodAtom = atom<GuideMethod>('bindApp')

export const workflowLocalAtoms = [
  stepAtom,
  methodAtom,
] as const

export const setStepAtom = atom(null, (_get, set, step: GuideStep) => {
  set(stepAtom, step)
})

export const selectMethodAtom = atom(null, (_get, set, method: GuideMethod) => {
  set(methodAtom, method)
  set(resetDeploymentTargetOptionsAtom)
  set(clearCreateDeploymentGuideUnsupportedDslNodesAtom)
})
