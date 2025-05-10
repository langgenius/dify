import { BlockEnum } from '../../types'
import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByArray, getNotExistVariablesByText } from '../../utils/workflow'
import { type ParameterExtractorNodeType, ReasoningModeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
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
  checkVarValid(payload: ParameterExtractorNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr: string[] = []

    const variables_warnings = getNotExistVariablesByArray([payload.query], varMap)
    if (variables_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.parameterExtractor.inputVar')} ${t('workflow.common.referenceVar')}${variables_warnings.join('、')}${t('workflow.common.noExist')}`)

    let vision_variable_warnings: string[] = []
    if (payload.vision?.configs?.variable_selector?.length) {
      vision_variable_warnings = getNotExistVariablesByArray([payload.vision.configs.variable_selector], varMap)
      if (vision_variable_warnings.length)
        errorMessageArr.push(`${t('workflow.nodes.llm.vision')} ${t('workflow.common.referenceVar')}${vision_variable_warnings.join('、')}${t('workflow.common.noExist')}`)
    }

    const instruction_warnings = getNotExistVariablesByText(payload.instruction, varMap)
    if (instruction_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.parameterExtractor.instruction')} ${t('workflow.common.referenceVar')}${instruction_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: [...variables_warnings, ...vision_variable_warnings, ...instruction_warnings],
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
