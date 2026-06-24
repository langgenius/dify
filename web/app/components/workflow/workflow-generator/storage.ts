import type { CompletionParams, Model } from '@/types/app'
import { createLocalStorageState } from 'foxact/create-local-storage-state'
import { ModelModeType } from '@/types/app'

export const EMPTY_WORKFLOW_GENERATOR_MODEL: Model = {
  name: '',
  provider: '',
  mode: ModelModeType.chat,
  completion_params: {} as CompletionParams,
}

const [
  useWorkflowGeneratorModel,
  _useWorkflowGeneratorModelValue,
  _useSetWorkflowGeneratorModel,
] = createLocalStorageState<Model>('workflow-gen-model', EMPTY_WORKFLOW_GENERATOR_MODEL)

export {
  useWorkflowGeneratorModel,
}
