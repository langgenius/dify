import { type NodeDefault, PromptRole } from '../../types'
import type { LLMNodeType } from './types'

const nodeDefault: NodeDefault<LLMNodeType> = {
  defaultValue: {
    model: {
      provider: '',
      name: '',
      mode: 'chat',
      completion_params: {
        temperature: 0.7,
      },
    },
    variables: [],
    prompt: [{
      role: PromptRole.system,
      text: '',
    }],
    context: {
      enabled: false,
      variable_selector: [],
    },
    vision: {
      enabled: false,
    },
  },
  getAvailablePrevNodes() {
    return []
  },
  getAvailableNextNodes() {
    return []
  },
}

export default nodeDefault
