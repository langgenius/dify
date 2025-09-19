import { genNodeMetaData } from '@/app/components/workflow/utils'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import type { NodeDefault, ToolWithProvider } from '../../types'
import type { ToolNodeType } from './types'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import { TOOL_OUTPUT_STRUCT } from '../../constants'
import { CollectionType } from '@/app/components/tools/types'
import { canFindTool } from '@/utils'
import { getMatchedSchemaType } from '../_base/components/variable/use-match-schema-type'

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
    tool_node_version: '2',
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
        if (!errorMessages && typeof value === 'object' && !!value.type && (value.value === undefined || value.value === null || value.value === '' || (Array.isArray(value.value) && value.value.length === 0)))
          errorMessages = t(`${i18nPrefix}.fieldRequired`, { field: field.label[language] })
      })
    }

    return {
      isValid: !errorMessages,
      errorMessage: errorMessages,
    }
  },
  getOutputVars(payload: ToolNodeType, allPluginInfoList: Record<string, ToolWithProvider[]>, _ragVars: any, { schemaTypeDefinitions } = { schemaTypeDefinitions: [] }) {
    const { provider_id, provider_type } = payload
    let currentTools: ToolWithProvider[] = []
    switch (provider_type) {
      case CollectionType.builtIn:
        currentTools = allPluginInfoList.buildInTools ?? []
        break
      case CollectionType.custom:
        currentTools = allPluginInfoList.customTools ?? []
        break
      case CollectionType.workflow:
        currentTools = allPluginInfoList.workflowTools ?? []
        break
      case CollectionType.mcp:
        currentTools = allPluginInfoList.mcpTools ?? []
        break
      default:
        currentTools = []
    }
    const currCollection = currentTools.find(item => canFindTool(item.id, provider_id))
    const currTool = currCollection?.tools.find(tool => tool.name === payload.tool_name)
    const output_schema = currTool?.output_schema
    let res: any[] = []
    if (!output_schema || !output_schema.properties) {
      res = TOOL_OUTPUT_STRUCT
    }
    else {
      const outputSchema: any[] = []
      Object.keys(output_schema.properties).forEach((outputKey) => {
        const output = output_schema.properties[outputKey]
        const dataType = output.type
        const schemaType = getMatchedSchemaType(output, schemaTypeDefinitions)
        let type = dataType === 'array'
          ? `Array[${output.items?.type ? output.items.type.slice(0, 1).toLocaleLowerCase() + output.items.type.slice(1) : 'Unknown'}]`
          : `${output.type ? output.type.slice(0, 1).toLocaleLowerCase() + output.type.slice(1) : 'Unknown'}`

        if (type === VarType.object && schemaType === 'file')
          type = VarType.file

        outputSchema.push({
          variable: outputKey,
          type,
          description: output.description,
          schemaType,
          children: output.type === 'object' ? {
            schema: {
              type: 'object',
              properties: output.properties,
            },
          } : undefined,
        })
      })
      res = [
        ...TOOL_OUTPUT_STRUCT,
        ...outputSchema,
      ]
    }
    return res
  },
}

export default nodeDefault
