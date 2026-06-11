'use client'

import type { UnsupportedDslNode } from '@/features/deployments/error'
import { atom } from 'jotai'

const deploymentOptionsUnsupportedDslNodesAtom = atom<UnsupportedDslNode[]>([])
const submissionUnsupportedDslNodesAtom = atom<UnsupportedDslNode[]>([])

export const unsupportedDslLocalAtoms = [
  deploymentOptionsUnsupportedDslNodesAtom,
  submissionUnsupportedDslNodesAtom,
] as const

export const unsupportedDslNodesAtom = atom((get): UnsupportedDslNode[] => {
  const submissionUnsupportedDslNodes = get(submissionUnsupportedDslNodesAtom)
  if (submissionUnsupportedDslNodes.length > 0)
    return submissionUnsupportedDslNodes

  return get(deploymentOptionsUnsupportedDslNodesAtom)
})

export const clearCreateDeploymentGuideUnsupportedDslNodesAtom = atom(null, (_get, set) => {
  set(deploymentOptionsUnsupportedDslNodesAtom, [])
  set(submissionUnsupportedDslNodesAtom, [])
})

export const setDeploymentOptionsUnsupportedDslNodesAtom = atom(null, (_get, set, nodes: UnsupportedDslNode[]) => {
  set(deploymentOptionsUnsupportedDslNodesAtom, nodes)
})

export const setSubmissionUnsupportedDslNodesAtom = atom(null, (_get, set, nodes: UnsupportedDslNode[]) => {
  set(submissionUnsupportedDslNodesAtom, nodes)
})
