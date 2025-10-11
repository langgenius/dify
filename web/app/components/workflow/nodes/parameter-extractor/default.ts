import type { NodeDefault } from '../../types'
import { type ParameterExtractorNodeType, ReasoningModeType } from './types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'
import { BlockClassificationEnum } from '@/app/components/workflow/block-selector/types'
const i18nPrefix = 'workflow'

const metaData = genNodeMetaData({
  classification: BlockClassificationEnum.Transform,
  sort: 6,
  type: BlockEnum.ParameterExtractor,
})
const nodeDefault: NodeDefault<ParameterExtractorNodeType> = {
  metaData,
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
    vision: {
      enabled: false,
    },
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
    if (!errorMessages && payload.vision?.enabled && !payload.vision.configs?.variable_selector?.length)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.errorMsg.fields.visionVariable`) })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
