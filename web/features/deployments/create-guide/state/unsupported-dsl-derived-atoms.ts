'use client'

import type { UnsupportedDslNode } from '@/features/deployments/error'
import { atom } from 'jotai'
import { loadable } from 'jotai/utils'
import { unsupportedDslNodeError } from '@/features/deployments/error'
import { deploymentTargetQueryEnabledAtom } from './deployment-target-gate-atoms'
import { deploymentOptionsQueryAtom } from './query-atoms'
import { submissionUnsupportedDslNodesAtom } from './unsupported-dsl-atoms'

const deploymentOptionsUnsupportedDslNodesAsyncAtom = atom(async (get): Promise<UnsupportedDslNode[]> => {
  const enabled = get(deploymentTargetQueryEnabledAtom)
  const deploymentOptionsQuery = get(deploymentOptionsQueryAtom)

  if (!enabled || !deploymentOptionsQuery.isError)
    return []

  return (await unsupportedDslNodeError(deploymentOptionsQuery.error))?.nodes ?? []
})

const deploymentOptionsUnsupportedDslNodesLoadableAtom = loadable(deploymentOptionsUnsupportedDslNodesAsyncAtom)

export const unsupportedDslNodesAtom = atom((get): UnsupportedDslNode[] => {
  const submissionUnsupportedDslNodes = get(submissionUnsupportedDslNodesAtom)
  if (submissionUnsupportedDslNodes.length > 0)
    return submissionUnsupportedDslNodes

  const deploymentOptionsUnsupportedDslNodes = get(deploymentOptionsUnsupportedDslNodesLoadableAtom)

  return deploymentOptionsUnsupportedDslNodes.state === 'hasData'
    ? deploymentOptionsUnsupportedDslNodes.data
    : []
})
