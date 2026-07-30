'use client'

import type { EnvVarValueSource } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { useState } from 'react'

type EnvironmentVariableSelection = {
  customValue: string
  source: EnvVarValueSource
}

export type DeploymentConfigurationValues = {
  credentials: Record<string, string>
  environmentVariables: Record<string, EnvironmentVariableSelection>
}

export function useDeploymentConfigurationValues() {
  const [values, setValues] = useState<DeploymentConfigurationValues>({
    credentials: {},
    environmentVariables: {},
  })

  return [values, setValues] as const
}
