import { BlockEnum } from '../../types'
import type { NodeDefault } from '../../types'
import type { ToolNodeType } from './types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/constants'
import { MAX_RETRIES_DEFAULT_TOOL_NODE, MAX_RETRIES_UPPER_BOUND_TOOL_NODE, RETRY_ENABLED_DEFAULT_TOOL_NODE, RETRY_INTERVAL_DEFAULT_TOOL_NODE, RETRY_INTERVAL_UPPER_BOUND_TOOL_NODE } from '@/config'

const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<ToolNodeType> = {
  defaultValue: {
    tool_parameters: {},
    tool_configurations: {},
    retry_config: {
      retry_enabled: RETRY_ENABLED_DEFAULT_TOOL_NODE,
      max_retries: MAX_RETRIES_DEFAULT_TOOL_NODE,
      retry_interval: RETRY_INTERVAL_DEFAULT_TOOL_NODE,
      max_retries_upper_bound: MAX_RETRIES_UPPER_BOUND_TOOL_NODE,
      retry_interval_upper_bound: RETRY_INTERVAL_UPPER_BOUND_TOOL_NODE,
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
  checkValid(payload: ToolNodeType, t: any, moreDataForCheckValid: any) {
    const { toolInputsSchema, toolSettingSchema, language, notAuthed } = moreDataForCheckValid
    let errorMessages = ''
    if (notAuthed)
      errorMessages = t(`${i18nPrefix}.authRequired`)

    if (!errorMessages) {
      toolInputsSchema.filter((field: any) => {
        return field.required
      }).forEach((field: any) => {
        const targetVar = payload.tool_parameters[field.variable]
        if (!targetVar) {
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: field.label })
          return
        }
        const { type: variable_type, value } = targetVar
        if (variable_type === VarKindType.variable) {
          if (!errorMessages && (!value || value.length === 0))
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: field.label })
        }
        else {
          if (!errorMessages && (value === undefined || value === null || value === ''))
            errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: field.label })
        }
      })
    }

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
