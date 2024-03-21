import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { ToolNodeType } from './types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'

const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<ToolNodeType> = {
  defaultValue: {
    tool_parameters: [],
    tool_configurations: {},
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
  checkValid(payload: ToolNodeType, t: any, moreDataForCheckValid: any) {
    // TODO: wait for publish add moreDataForCheckValid
    if (!moreDataForCheckValid)
      return { isValid: true }

    const { toolInputsSchema, toolSettingSchema, language } = moreDataForCheckValid
    let errorMessages = ''

    toolInputsSchema.filter((field: any) => {
      return field.required
    }).forEach((field: any) => {
      const targetVar = payload.tool_parameters.find((item: any) => item.variable === field.variable)
      if (!targetVar)
        return
      const { variable_type, value, value_selector } = targetVar
      if (variable_type === VarKindType.selector) {
        if (!errorMessages && (!value_selector || value_selector.length === 0))
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: field.label })
      }
      if (variable_type === VarKindType.static) {
        if (!errorMessages && (value === undefined || value === null || value === ''))
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: field.label })
      }
    })

    if (!errorMessages) {
      toolSettingSchema.filter((field: any) => {
        return field.required
      }).forEach((field: any) => {
        const value = payload.tool_configurations[field.variable]
        if (!errorMessages && (value === undefined || value === null || value === ''))
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: field.label[language] })
      })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
}

export default nodeDefault
