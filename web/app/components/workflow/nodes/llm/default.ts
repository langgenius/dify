import { BlockEnum, EditionType } from '../../types'
import { type NodeDefault, type PromptItem, PromptRole } from '../../types'
import type { LLMNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

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
      const isPromptEmpty = isChatModel
        ? !(payload.prompt_template as PromptItem[]).some((t) => {
          if (t.edition_type === EditionType.jinja2)
            return t.jinja2_text !== ''

          return t.text !== ''
        })
        : ((payload.prompt_template as PromptItem).edition_type === EditionType.jinja2 ? (payload.prompt_template as PromptItem).jinja2_text === '' : (payload.prompt_template as PromptItem).text === '')
      if (isPromptEmpty)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.llm.prompt') })
    }

    if (!errorMessages && !!payload.memory) {
      const isChatModel = payload.model.mode === 'chat'
      // payload.memory.query_prompt_template not pass is default: {{#sys.query#}}
      if (isChatModel && !!payload.memory.query_prompt_template && !payload.memory.query_prompt_template.includes('{{#sys.query#}}'))
        errorMessages = t('workflow.nodes.llm.sysQueryInUser')
    }

    if (!errorMessages) {
      const isChatModel = payload.model.mode === 'chat'
      const isShowVars = (() => {
        if (isChatModel)
          return (payload.prompt_template as PromptItem[]).some(item => item.edition_type === EditionType.jinja2)
        return (payload.prompt_template as PromptItem).edition_type === EditionType.jinja2
      })()
      if (isShowVars && payload.prompt_config?.jinja2_variables) {
        payload.prompt_config?.jinja2_variables.forEach((i) => {
          if (!errorMessages && !i.variable)
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variable`) })
          if (!errorMessages && !i.value_selector.length)
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
        })
      }
    }
    if (!errorMessages && payload.vision?.enabled && !payload.vision.configs?.variable_selector?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.visionVariable`) })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
