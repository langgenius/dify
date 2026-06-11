'use client'

import type { UnsupportedDslNode } from '@/features/deployments/error'
import { atom } from 'jotai'

export const submissionUnsupportedDslNodesAtom = atom<UnsupportedDslNode[]>([])

export const clearCreateDeploymentGuideUnsupportedDslNodesAtom = atom(null, (_get, set) => {
  set(submissionUnsupportedDslNodesAtom, [])
})

export const setSubmissionUnsupportedDslNodesAtom = atom(null, (_get, set, nodes: UnsupportedDslNode[]) => {
  set(submissionUnsupportedDslNodesAtom, nodes)
})
