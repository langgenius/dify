import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type {
  Param,
  ParameterExtractorNodeType,
} from '@/app/components/workflow/nodes/parameter-extractor/types'
import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { InputVar, Node, PromptItem } from '@/app/components/workflow/types'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { createNode } from './test-collaboration-session'

export const createVariable = (variable: string, overrides: Partial<InputVar> = {}): InputVar => ({
  variable,
  label: variable,
  type: InputVarType.textInput,
  required: true,
  ...overrides,
})

export const createStartNode = (variables: InputVar[]): Node<StartNodeType> => {
  const node = createNode('start')
  return { ...node, data: { ...node.data, variables } }
}

export const createLLMNode = (prompt_template: PromptItem[] | PromptItem): Node<LLMNodeType> => ({
  id: 'llm',
  type: 'custom',
  position: { x: 200, y: 100 },
  data: {
    type: BlockEnum.LLM,
    title: 'LLM',
    desc: '',
    model: {
      mode: Array.isArray(prompt_template) ? 'chat' : 'completion',
      name: 'test-model',
      provider: 'test-provider',
      completion_params: {},
    },
    context: { enabled: false, variable_selector: [] },
    vision: { enabled: false },
    prompt_template,
  },
})

export const createParameterNode = (parameters: Param[]): Node<ParameterExtractorNodeType> => ({
  id: 'parameters',
  type: 'custom',
  position: { x: 400, y: 100 },
  data: {
    type: BlockEnum.ParameterExtractor,
    title: 'Parameters',
    desc: '',
    model: { mode: 'chat', name: 'test-model', provider: 'test-provider', completion_params: {} },
    query: [],
    reasoning_mode: 'prompt',
    instruction: '',
    vision: { enabled: false },
    parameters,
  },
})
