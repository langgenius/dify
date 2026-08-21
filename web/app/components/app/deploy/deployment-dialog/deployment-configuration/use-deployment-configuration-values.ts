'use client'

import type { EnvVarValueSource } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { useCallback, useRef, useState } from 'react'

export type EnvironmentVariableSelection = {
  customValue: string
  source: EnvVarValueSource
}

export type DeploymentConfigurationValues = {
  credentials: Record<string, string>
  environmentVariables: Record<string, EnvironmentVariableSelection>
}

export type DeploymentConfigurationValuesController = {
  credentials: DeploymentConfigurationValues['credentials']
  getEnvironmentVariableSelection: (key: string) => EnvironmentVariableSelection | undefined
  getValues: () => DeploymentConfigurationValues
  setCredential: (key: string, value: string) => void
  setEnvironmentVariableSelection: (key: string, value: EnvironmentVariableSelection) => void
}

export function useDeploymentConfigurationValues() {
  const valuesRef = useRef<DeploymentConfigurationValues>({
    credentials: {},
    environmentVariables: {},
  })
  const [credentials, setCredentials] = useState<DeploymentConfigurationValues['credentials']>({})

  const getEnvironmentVariableSelection = useCallback(
    (key: string) => valuesRef.current.environmentVariables[key],
    [],
  )
  const getValues = useCallback(() => valuesRef.current, [])
  const setCredential = useCallback((key: string, value: string) => {
    const current = valuesRef.current
    if (current.credentials[key] === value) return

    const nextCredentials = {
      ...current.credentials,
      [key]: value,
    }
    valuesRef.current = {
      ...current,
      credentials: nextCredentials,
    }
    setCredentials(nextCredentials)
  }, [])
  const setEnvironmentVariableSelection = useCallback(
    (key: string, value: EnvironmentVariableSelection) => {
      valuesRef.current.environmentVariables[key] = value
    },
    [],
  )

  return {
    credentials,
    getEnvironmentVariableSelection,
    getValues,
    setCredential,
    setEnvironmentVariableSelection,
  } satisfies DeploymentConfigurationValuesController
}
