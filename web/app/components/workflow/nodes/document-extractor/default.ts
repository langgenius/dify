import { BlockEnum } from '../../types'
import type { NodeDefault, Var } from '../../types'
import { getNotExistVariablesByArray } from '../../utils/workflow'
import type { DocExtractorNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<DocExtractorNodeType> = {
  defaultValue: {
    variable_selector: [],
    is_array_file: false,
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
  checkValid(payload: DocExtractorNodeType, t: any) {
    let errorMessages = ''
    const { variable_selector: variable } = payload

    if (!errorMessages && !variable?.length)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.assigner.assignedVariable') })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  checkVarValid(payload: DocExtractorNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr: string[] = []

    const variables_warnings = getNotExistVariablesByArray([payload.variable_selector], varMap)
    if (variables_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.docExtractor.inputVar')} ${t('workflow.common.referenceVar')}${variables_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: variables_warnings,
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
