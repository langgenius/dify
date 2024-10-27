import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import { CodeLanguage, type CodeNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

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
  checkValid(payload: CodeNodeType, t: any) {
    let errorMessages = ''
    const { code, variables } = payload
    if (!errorMessages && variables.filter(v => !v.variable).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variable`) })
    if (!errorMessages && variables.filter(v => !v.value_selector.length).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
    if (!errorMessages && !code)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.code`) })

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },

}

export default nodeDefault
