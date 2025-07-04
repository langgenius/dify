import { BlockEnum } from '../../types'
import type { Node, NodeDefault, NodeOutPutVar } from '../../types'
import { CodeLanguage, type CodeNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
import { isConversationVar, isENV, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'

const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<CodeNodeType> = {
  defaultValue: {
    code: '',
    code_language: CodeLanguage.python3,
    variables: [],
    outputs: {},
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
  checkValid(payload: CodeNodeType, t: any, moreDataForCheckValid: { node: Node, availableVars: NodeOutPutVar[], availableNodes: Node[] }) {
    let errorMessages = ''
    const { code, variables } = payload
    if (!errorMessages && variables.filter(v => !v.variable).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variable`) })
    if (!errorMessages && variables.filter(v => !v.value_selector.length).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
    if (!errorMessages && !code)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.code`) })
    if (!errorMessages && moreDataForCheckValid) {
      const availableVars = moreDataForCheckValid.availableVars
      console.log('=======================节点名称：', moreDataForCheckValid.node.data.title)
      console.log('=======================代码参数检查：', variables)
      console.log('=======================可用变量：', moreDataForCheckValid.availableVars)
      console.log('=======================可用节点：', moreDataForCheckValid.availableNodes)
      console.log('=========================================================================================================')
      variables.forEach((variable) => {
        const isEnv = isENV(variable.value_selector)
        const isConvVar = isConversationVar(variable.value_selector)
        const isSysVar = isSystemVar(variable.value_selector)
        if (!isEnv && !isConvVar && !isSysVar) {
          const node = availableVars.find(v => v.nodeId === variable?.value_selector[0])
          if (!node)
            errorMessages = t(`${i18nPrefix}.invalidVariable`)
        }
      })
    }
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },

}

export default nodeDefault
