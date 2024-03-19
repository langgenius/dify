import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { TemplateTransformNodeType } from './types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'
const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<TemplateTransformNodeType> = {
  defaultValue: {
    variables: [],
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
  checkValid(payload: TemplateTransformNodeType, t: any) {
    let errorMessages = ''
    const { template, variables } = payload

    if (!errorMessages && variables.filter(v => !v.variable).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variable`) })
    if (!errorMessages && variables.filter(v => !v.value_selector.length).length > 0)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t(`${i18nPrefix}.fields.variableValue`) })
    if (!errorMessages && !template)
      errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: t('workflow.nodes.templateTransform.code') })
    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
