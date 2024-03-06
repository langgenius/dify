import { BlockEnum, PromptRole } from '../../types'
import type { LLMNodeType } from './types'
import { Resolution } from '@/types/app'

export const mockData: LLMNodeType = {
  title: 'LLM',
  desc: 'Test',
  type: BlockEnum.LLM,
  model: {
    provider: 'openai',
    name: 'gpt-4',
    mode: 'chat',
    completion_params: {
      temperature: 0.7,
    },
  },
  variables: [
    {
      variable: 'name',
      value_selector: ['aaa', 'name'],
    },
    {
      variable: 'age',
      value_selector: ['bbb', 'b', 'c'],
    },
  ],
  prompt: [
    {
      role: PromptRole.system,
      text: '',
    },
  ],
  memory: {
    role_prefix: {
      user: 'user: ',
      assistant: 'assistant: ',
    },
    window: {
      enabled: false,
      size: 0,
    },
  },
  context: {
    enabled: false,
    variable_selector: ['aaa', 'name'],
  },
  vision: {
    enabled: true,
    configs: {
      detail: Resolution.low,
    },
  },
}
