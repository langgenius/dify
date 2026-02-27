import type { NodeDefault, PromptItem } from '../../types'
import type { LLMNodeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
// import { RETRIEVAL_OUTPUT_STRUCT } from '../../constants'
import { AppModeEnum } from '@/types/app'
import { BlockEnum, EditionType, PromptRole } from '../../types'

const RETRIEVAL_OUTPUT_STRUCT = `{
  "content": "",
  "title": "",
  "url": "",
  "icon": "",
  "metadata": {
    "dataset_id": "",
    "dataset_name": "",
    "document_id": [],
    "document_name": "",
    "document_data_source_type": "",
    "segment_id": "",
    "segment_position": "",
    "segment_word_count": "",
    "segment_hit_count": "",
    "segment_index_node_hash": "",
    "score": ""
  }
}`

const i18nPrefix = 'errorMsg'

const metaData = genNodeMetaData({
  sort: 1,
  type: BlockEnum.LLM,
})
const nodeDefault: NodeDefault<LLMNodeType> = {
  metaData,
  defaultValue: {
    model: {
      provider: '',
      name: '',
      mode: AppModeEnum.CHAT,
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
  defaultRunInputData: {
    '#context#': [RETRIEVAL_OUTPUT_STRUCT],
    '#files#': [],
  },
  checkValid(payload: LLMNodeType, t: any) {
    let errorMessages = ''
    if (!errorMessages && !payload.model.provider)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.model`, { ns: 'workflow' }) })

    if (!errorMessages && !payload.memory) {
      const isChatModel = payload.model.mode === AppModeEnum.CHAT
      const isPromptEmpty = isChatModel
        ? !(payload.prompt_template as PromptItem[]).some((t) => {
            if (t.edition_type === EditionType.jinja2)
              return t.jinja2_text !== ''

            return t.text !== ''
          })
        : ((payload.prompt_template as PromptItem).edition_type === EditionType.jinja2 ? (payload.prompt_template as PromptItem).jinja2_text === '' : (payload.prompt_template as PromptItem).text === '')
      if (isPromptEmpty)
        errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t('nodes.llm.prompt', { ns: 'workflow' }) })
    }

    if (!errorMessages && !!payload.memory) {
      const isChatModel = payload.model.mode === AppModeEnum.CHAT
      // payload.memory.query_prompt_template not pass is default: {{#sys.query#}}
      if (isChatModel && !!payload.memory.query_prompt_template && !payload.memory.query_prompt_template.includes('{{#sys.query#}}'))
        errorMessages = t('nodes.llm.sysQueryInUser', { ns: 'workflow' })
    }

    if (!errorMessages) {
      const isChatModel = payload.model.mode === AppModeEnum.CHAT
      const isShowVars = (() => {
        if (isChatModel)
          return (payload.prompt_template as PromptItem[]).some(item => item.edition_type === EditionType.jinja2)
        return (payload.prompt_template as PromptItem).edition_type === EditionType.jinja2
      })()
      if (isShowVars && payload.prompt_config?.jinja2_variables) {
        payload.prompt_config?.jinja2_variables.forEach((i) => {
          if (!errorMessages && !i.variable)
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variable`, { ns: 'workflow' }) })
          if (!errorMessages && !i.value_selector.length)
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.variableValue`, { ns: 'workflow' }) })
        })
      }
    }
    if (!errorMessages && payload.vision?.enabled && !payload.vision.configs?.variable_selector?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { ns: 'workflow', field: t(`${i18nPrefix}.fields.visionVariable`, { ns: 'workflow' }) })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
