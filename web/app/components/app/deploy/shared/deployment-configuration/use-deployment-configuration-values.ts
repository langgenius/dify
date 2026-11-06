'use client'

import type { EnvVarValueSource } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { LLMEnvironmentVariableValue } from '@/app/components/workflow/types'
import { useCallback, useRef } from 'react'

export type EnvironmentVariableSelection = {
  customValue: string | LLMEnvironmentVariableValue
  source: EnvVarValueSource
}

export type DeploymentConfigurationValues = {
  credentials: Record<string, string>
  environmentVariables: Record<string, EnvironmentVariableSelection>
}

export type DeploymentConfigurationValuesController = {
  getCredential: (key: string) => string | undefined
  getEnvironmentVariableSelection: (
    workflowId: string,
    key: string,
  ) => EnvironmentVariableSelection | undefined
  getValues: () => DeploymentConfigurationValues
  setCredential: (key: string, value: string) => void
  setEnvironmentVariableSelection: (
    workflowId: string,
    key: string,
    value: EnvironmentVariableSelection,
  ) => void
}

export function environmentVariableSelectionKey(workflowId: string, key: string) {
  return JSON.stringify([workflowId, key])
}

export function useDeploymentConfigurationValues() {
  const valuesRef = useRef<DeploymentConfigurationValues>({
    credentials: {},
    environmentVariables: {},
  })
  const getCredential = useCallback((key: string) => valuesRef.current.credentials[key], [])

  const getEnvironmentVariableSelection = useCallback(
    (workflowId: string, key: string) =>
      valuesRef.current.environmentVariables[environmentVariableSelectionKey(workflowId, key)],
    [],
  )
  const getValues = useCallback(() => valuesRef.current, [])
  const setCredential = useCallback((key: string, value: string) => {
    const current = valuesRef.current
    if (current.credentials[key] === value) return

    valuesRef.current = {
      ...current,
      credentials: {
        ...current.credentials,
        [key]: value,
      },
    }
  }, [])
  const setEnvironmentVariableSelection = useCallback(
    (workflowId: string, key: string, value: EnvironmentVariableSelection) => {
      const current = valuesRef.current
      valuesRef.current = {
        ...current,
        environmentVariables: {
          ...current.environmentVariables,
          [environmentVariableSelectionKey(workflowId, key)]: value,
        },
      }
    },
    [],
  )

  return {
    getCredential,
    getEnvironmentVariableSelection,
    getValues,
    setCredential,
    setEnvironmentVariableSelection,
  } satisfies DeploymentConfigurationValuesController
}
