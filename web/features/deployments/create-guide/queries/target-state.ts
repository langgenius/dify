'use client'

import type { App } from '@/types/app'
import { useAtomValue } from 'jotai'
import { createDeploymentTargetQueryGate } from '../models/deployment-target/query-gate'
import {
  createDslState,
} from '../models/selectors'
import {
  dslContentAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../state/dsl-atoms'
import { methodAtom } from '../state/workflow-atoms'

export function useDeploymentTargetQueryInputs({
  effectiveSelectedApp,
  shouldResolveDeploymentTarget,
}: {
  effectiveSelectedApp?: App
  shouldResolveDeploymentTarget: boolean
}) {
  const method = useAtomValue(methodAtom)
  const dslContent = useAtomValue(dslContentAtom)
  const dslReadError = useAtomValue(dslReadErrorAtom)
  const isReadingDsl = useAtomValue(isReadingDslAtom)
  const dslState = createDslState({
    dslContent,
    dslReadError,
    isReadingDsl,
    method,
  })
  const queryGate = createDeploymentTargetQueryGate({
    dslReadError,
    dslState,
    effectiveSelectedApp,
    isReadingDsl,
    method,
    shouldResolveDeploymentTarget,
  })

  return {
    dslContent,
    dslReadError,
    dslState,
    isReadingDsl,
    method,
    queryGate,
  }
}
