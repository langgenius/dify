import { BlockEnum } from '../../types'
import { type NodeDefault, PromptRole } from '../../types'
import type { LLMNodeType } from './types'
import type { PromptItem } from '@/models/debug'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

const i18nPrefix = 'workflow.errorMsg'

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
    prompt_template: [{
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
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: LLMNodeType, t: any) {
    let errorMessages = ''
    if (!errorMessages && !payload.model.provider)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.model`) })

    if (!errorMessages && !payload.memory) {
      const isChatModel = payload.model.mode === 'chat'
      const isPromptyEmpty = isChatModel ? !(payload.prompt_template as PromptItem[]).some(t => t.text !== '') : (payload.prompt_template as PromptItem).text === ''
      if (isPromptyEmpty)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.llm.prompt') })
    }

    if (!errorMessages && !!payload.memory) {
      const isChatModel = payload.model.mode === 'chat'
      // payload.memory.query_prompt_template not pass is default: {{#sys.query#}}
      if (isChatModel && !!payload.memory.query_prompt_template && !payload.memory.query_prompt_template.includes('{{#sys.query#}}'))
        errorMessages = t('workflow.nodes.llm.sysQueryInUser')
    }
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
