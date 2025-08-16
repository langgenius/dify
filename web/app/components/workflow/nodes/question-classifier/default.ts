import type { NodeDefault, Var } from '../../types'
import { BlockEnum } from '../../types'
import { getNotExistVariablesByArray, getNotExistVariablesByText } from '../../utils/workflow'
import type { QuestionClassifierNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'

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
    _targetBranches: [
      {
        id: '1',
        name: '',
      },
      {
        id: '2',
        name: '',
      },
    ],
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

    if (!errorMessages && payload.vision?.enabled && !payload.vision.configs?.variable_selector?.length)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.errorMsg.fields.visionVariable`) })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  checkVarValid(payload: QuestionClassifierNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr = []

    const query_variable_selector_warnings = getNotExistVariablesByArray([payload.query_variable_selector], varMap)
    if (query_variable_selector_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.questionClassifiers.inputVars')} ${t('workflow.common.referenceVar')}${query_variable_selector_warnings.join('、')}${t('workflow.common.noExist')}`)

    let vision_variable_selector_warnings: string[] = []
    if (payload.vision?.configs?.variable_selector?.length) {
      vision_variable_selector_warnings = getNotExistVariablesByArray([payload.vision?.configs?.variable_selector], varMap)
      if (vision_variable_selector_warnings.length)
        errorMessageArr.push(`${t('workflow.nodes.llm.vision')} ${t('workflow.common.referenceVar')}${vision_variable_selector_warnings.join('、')}${t('workflow.common.noExist')}`)
    }

    const instruction_warnings: string[] = getNotExistVariablesByText(payload.instruction, varMap)
    if (instruction_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.questionClassifiers.advancedSetting')}-${t('workflow.nodes.questionClassifiers.instruction')} ${t('workflow.common.referenceVar')}${instruction_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: [...query_variable_selector_warnings, ...vision_variable_selector_warnings, ...instruction_warnings],
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
