import { type NodeDefault, VarType } from '../../types'
import { BlockEnum } from '../../types'
import type { VariableAssignerNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

const i18nPrefix = 'workflow'

const nodeDefault: NodeDefault<VariableAssignerNodeType> = {
  defaultValue: {
    output_type: VarType.string,
    variables: [],
  },
  getAvailablePrevNodes(isChatMode: boolean) {
    const nodes = isChatMode
      ? ALL_CHAT_AVAILABLE_BLOCKS
      : ALL_COMPLETION_AVAILABLE_BLOCKS.filter(type => type !== BlockEnum.End)
    return nodes.filter(type => type !== BlockEnum.IfElse && type !== BlockEnum.QuestionClassifier)
  },
  getAvailableNextNodes(isChatMode: boolean) {
    const nodes = isChatMode ? ALL_CHAT_AVAILABLE_BLOCKS : ALL_COMPLETION_AVAILABLE_BLOCKS
    return nodes
  },
  checkValid(payload: VariableAssignerNodeType, t: any) {
    let errorMessages = ''
    const { variables } = payload
    if (!variables || variables.length === 0)
      errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.nodes.variableAssigner.title`) })
    if (!errorMessages) {
      variables.forEach((variable) => {
        if (!variable || variable.length === 0)
          errorMessages = t(`${i18nPrefix}.errorMsg.fieldRequired`, { field: t(`${i18nPrefix}.errorMsg.fields.variableValue`) })
      })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
