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

// Last instruction the user generated from, persisted across opens so reopening
// the generator resumes where they left off instead of a blank box (the palette's
// inline-captured instruction still takes precedence over this).
const [
  useWorkflowGeneratorLastInstruction,
  _useWorkflowGeneratorLastInstructionValue,
  _useSetWorkflowGeneratorLastInstruction,
] = createLocalStorageState<string>('workflow-gen-last-instruction', '')

export {
  useWorkflowGeneratorLastInstruction,
  useWorkflowGeneratorModel,
}
