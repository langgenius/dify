import type {
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type { RuntimeCredentialBindingSelections } from '../components/runtime-credential-bindings-utils'

export type GuideMethod = 'bindApp' | 'importDsl'
export type GuideStep = 'source' | 'release' | 'target'
export type EnvironmentOption = Environment & { id: string }
export type BindingSelections = RuntimeCredentialBindingSelections
