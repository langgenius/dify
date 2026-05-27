import type {
  Environment,
} from '@dify/contracts/enterprise/types.gen'
import type { RuntimeCredentialBindingSelections } from '../components/runtime-credential-bindings-utils'

export type GuideMethod = 'bindApp' | 'importDsl'
export type GuideStep = 'method' | 'source' | 'release' | 'target' | 'review' | 'done'
export type EnvironmentOption = Environment & { id: string }
export type BindingSelections = RuntimeCredentialBindingSelections
