import type {
  CredentialSlot,
  DeploymentOptions,
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type {
  EnvVarBindingSlot,
  EnvVarValues,
} from '@/features/deployments/components/env-var-bindings'
import type { RuntimeCredentialBindingSelections } from '@/features/deployments/components/runtime-credential-bindings-utils'

type DeployableEnvironmentsRefetcher = {
  refetch: () => Promise<{
    data?: {
      data: Environment[]
    }
  }>
}

export type DeploymentTargetSubmissionState = {
  bindingSelections: RuntimeCredentialBindingSelections
  bindingSlots: CredentialSlot[]
  deployableEnvironmentsQuery: DeployableEnvironmentsRefetcher
  deploymentOptions?: DeploymentOptions
  envVarSlots: EnvVarBindingSlot[]
  envVarValues: EnvVarValues
  requiredEnvVarsReady: boolean
  selectedEnvironment?: Environment
  selectedEnvironmentId: string
}
