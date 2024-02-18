import type { LLMNodeData } from '../../types'
import { MemoryRole } from '../../types'
import { Resolution } from '@/types/app'

export const mockLLMNodeData: LLMNodeData = {
  title: 'Test',
  desc: 'Test',
  type: 'Test',
  model: {
    provider: 'openai',
    name: 'gpt-4',
    mode: 'completion',
    completion_params: {
      temperature: 0.7,
    },
  },
  variables: [],
  prompt: [],
  memory: {
    role_prefix: MemoryRole.assistant,
    window: {
      enabled: false,
      size: 0,
    },
  },
  context: {
    enabled: false,
    size: 0,
  },
  vision: {
    enabled: false,
    variable_selector: [],
    configs: {
      detail: Resolution.low,
    },
  },
}
