'use client'

import type { UnsupportedDslNode } from '@/features/deployments/error'
import type { App } from '@/types/app'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'
import { unsupportedDslNodeError } from '@/features/deployments/error'
import { createDeploymentTargetQueryGate } from '../../models/deployment-target/query-gate'
import {
  createDslState,
} from '../../models/dsl'
import {
  createSelectedWorkflowSourceApp,
} from '../../models/source'
import { useDeploymentOptionsQuery } from '../../queries/target-options'
import {
  dslContentAtom,
  dslReadErrorAtom,
  isReadingDslAtom,
} from '../../state/dsl-atoms'
import {
  selectedAppAtom,
} from '../../state/source-atoms'
import {
  setDeploymentOptionsUnsupportedDslNodesAtom,
} from '../../state/unsupported-dsl-atoms'
import { methodAtom } from '../../state/workflow-atoms'

function useDeploymentOptionsUnsupportedDslNodeSync({
  enabled,
  error,
  isError,
  setDeploymentOptionsUnsupportedDslNodes,
}: {
  enabled: boolean
  error: unknown
  isError: boolean
  setDeploymentOptionsUnsupportedDslNodes: (nodes: UnsupportedDslNode[]) => void
}) {
  useEffect(() => {
    let cancelled = false

    if (!enabled)
      return

    if (!isError) {
      setDeploymentOptionsUnsupportedDslNodes([])
      return
    }

    // The bindings section owns deployment-options errors, then shares only unsupported DSL nodes.
    void unsupportedDslNodeError(error).then((unsupportedError) => {
      if (cancelled)
        return

      setDeploymentOptionsUnsupportedDslNodes(unsupportedError?.nodes ?? [])
    })

    return () => {
      cancelled = true
    }
  }, [enabled, error, isError, setDeploymentOptionsUnsupportedDslNodes])
}

export function useDeploymentTargetQueryModel({
  effectiveSelectedApp,
}: {
  effectiveSelectedApp?: App
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

export function useDeploymentOptionsQueryResult({
  dslState,
  effectiveSelectedApp,
  method,
  queryGate,
  syncUnsupportedDslNodes = true,
}: Parameters<typeof useDeploymentOptionsQuery>[0] & {
  syncUnsupportedDslNodes?: boolean
}) {
  const setDeploymentOptionsUnsupportedDslNodes = useSetAtom(setDeploymentOptionsUnsupportedDslNodesAtom)
  const deploymentOptionsResult = useDeploymentOptionsQuery({
    dslState,
    effectiveSelectedApp,
    method,
    queryGate,
  })

  useDeploymentOptionsUnsupportedDslNodeSync({
    enabled: syncUnsupportedDslNodes,
    error: deploymentOptionsResult.deploymentOptionsQuery.error,
    isError: deploymentOptionsResult.deploymentOptionsQuery.isError,
    setDeploymentOptionsUnsupportedDslNodes,
  })

  return deploymentOptionsResult
}

export function useTargetStepDeploymentQueryModel() {
  const selectedApp = useAtomValue(selectedAppAtom)
  const effectiveSelectedApp = createSelectedWorkflowSourceApp(selectedApp)
  const targetQueryModel = useDeploymentTargetQueryModel({
    effectiveSelectedApp,
  })

  return {
    effectiveSelectedApp,
    ...targetQueryModel,
  }
}
