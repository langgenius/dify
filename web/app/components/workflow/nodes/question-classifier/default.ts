import type { NodeDefault } from '../../types'
import { BlockEnum } from '../../types'
import type { QuestionClassifierNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

const i18nPrefix = 'workflow'

const nodeDefault: NodeDefault<QuestionClassifierNodeType> = {
  defaultValue: {
    query_variable_selector: [],
    model: {
      provider: '',
      name: '',
      mode: 'chat',
      completion_params: {
        temperature: 0.7,
      },
    },
    classes: [
      {
        id: '1',
        name: '',
      },
      {
        id: '2',
        name: '',
      },
    ],
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
  checkValid(payload: QuestionClassifierNodeType, t: any) {
    let errorMessages = ''
    if (!errorMessages && (!payload.query_variable_selector || payload.query_variable_selector.length === 0))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.questionClassifiers.inputVars`) })

    if (!errorMessages && !payload.model.provider)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.questionClassifiers.model`) })

    if (!errorMessages && (!payload.classes || payload.classes.length === 0))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.questionClassifiers.class`) })

    if (!errorMessages && (payload.classes.some(item => !item.name)))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.questionClassifiers.topicName`) })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
