import type { RAGPipelineVariable } from '@/models/pipeline'
import { PipelineInputVarType } from '@/models/pipeline'

export const createPipelineVariable = (
  overrides: Partial<RAGPipelineVariable> = {},
): RAGPipelineVariable => ({
  belong_to_node_id: 'source-node',
  type: PipelineInputVarType.textInput,
  variable: 'source',
  label: 'Source',
  required: true,
  default_value: '',
  max_length: 256,
  placeholder: 'Enter source',
  tooltips: '',
  options: [],
  ...overrides,
})
