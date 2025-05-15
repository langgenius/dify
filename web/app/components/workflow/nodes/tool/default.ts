import { BlockEnum } from '../../types'
import type { NodeDefault, Var } from '../../types'
import type { ToolNodeType } from './types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { ALL_CHAT_AVAILABLE_BLOCKS, ALL_COMPLETION_AVAILABLE_BLOCKS } from '@/app/components/workflow/blocks'
import { getNotExistVariablesByArray, getNotExistVariablesByText } from '../../utils/workflow'

const i18nPrefix = 'workflow.errorMsg'

const nodeDefault: NodeDefault<ToolNodeType> = {
  defaultValue: {
    tool_parameters: {},
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
  checkVarValid(payload: ToolNodeType, varMap: Record<string, Var>, t: any) {
    const errorMessageArr = []
    const tool_parametersMap = payload.tool_parameters
    const tool_parameters_array = Object.values(tool_parametersMap)
    const tool_parameters_warnings: string[] = []
    tool_parameters_array?.forEach((item) => {
      if (!item.value)
        return
      if (Array.isArray(item.value)) {
        const warnings = getNotExistVariablesByArray([item.value], varMap)
        if (warnings.length)
          tool_parameters_warnings.push(...warnings)
        return
      }
      if (typeof item.value === 'string') {
        const warnings = getNotExistVariablesByText(item.value, varMap)
        if (warnings.length)
          tool_parameters_warnings.push(...warnings)
      }
    })
    if (tool_parameters_warnings.length)
      errorMessageArr.push(`${t('workflow.nodes.tool.inputVars')} ${t('workflow.common.referenceVar')}${tool_parameters_warnings.join('、')}${t('workflow.common.noExist')}`)

    return {
      isValid: true,
      warning_vars: tool_parameters_warnings,
      errorMessage: errorMessageArr,
    }
  },
}

export default nodeDefault
