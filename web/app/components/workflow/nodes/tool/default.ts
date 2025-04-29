import type { NodeDefault } from '../../types'
import type { ToolNodeType } from './types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum } from '@/app/components/workflow/types'

const i18nPrefix = 'workflow.errorMsg'

const metaData = genNodeMetaData({
  sort: -1,
  type: BlockEnum.Tool,
  helpLinkUri: 'tools',
})
const nodeDefault: NodeDefault<ToolNodeType> = {
  metaData,
  defaultValue: {
    tool_parameters: {},
    tool_configurations: {},
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
