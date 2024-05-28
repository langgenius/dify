import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { type ParameterExtractorNodeType, ReasoningModeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'
const i18nPrefix = 'workflow'

const nodeDefault: NodeDefault<ParameterExtractorNodeType> = {
  defaultValue: {
    query: [],
    model: {
      provider: '',
      name: '',
      mode: 'chat',
      completion_params: {
        temperature: 0.7,
      },
    },
    reasoning_mode: ReasoningModeType.prompt,
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
  checkValid(payload: ParameterExtractorNodeType, t: any) {
    let errorMessages = ''
    if (!errorMessages && (!payload.query || payload.query.length === 0))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.parameterExtractor.inputVar`) })

    if (!errorMessages && !payload.model.provider)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.parameterExtractor.model`) })

    if (!errorMessages && (!payload.parameters || payload.parameters.length === 0))
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.parameterExtractor.extractParameters`) })

    if (!errorMessages) {
      payload.parameters.forEach((param) => {
        if (errorMessages)
          return
        if (!param.name) {
          errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.parameterExtractor.addExtractParameterContent.namePlaceholder`) })
          return
        }
        if (!param.type) {
          errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.parameterExtractor.addExtractParameterContent.typePlaceholder`) })
          return
        }
        if (!param.description)
          errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.parameterExtractor.addExtractParameterContent.descriptionPlaceholder`) })
      })
    }
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
