import type {
  InputVar,
  ToolWithProvider,
} from '../types'
import type { ToolNodeType } from '../nodes/tool/types'
import { CollectionType } from '@/app/components/tools/types'
import { toolParametersToFormSchemas } from '@/app/components/tools/utils/to-form-schema'
import { canFindTool } from '@/utils'

export const getToolCheckParams = (
  toolData: ToolNodeType,
  buildInTools: ToolWithProvider[],
  customTools: ToolWithProvider[],
  workflowTools: ToolWithProvider[],
  language: string,
) => {
  const { provider_id, provider_type, tool_name } = toolData
  const isBuiltIn = provider_type === CollectionType.builtIn
  const currentTools = provider_type === CollectionType.builtIn ? buildInTools : provider_type === CollectionType.custom ? customTools : workflowTools
  const currCollection = currentTools.find(item => canFindTool(item.id, provider_id))
  const currTool = currCollection?.tools.find(tool => tool.name === tool_name)
  const formSchemas = currTool ? toolParametersToFormSchemas(currTool.parameters) : []
  const toolInputVarSchema = formSchemas.filter(item => item.form === 'llm')
  const toolSettingSchema = formSchemas.filter(item => item.form !== 'llm')

  return {
    toolInputsSchema: (() => {
      const formInputs: InputVar[] = []
      toolInputVarSchema.forEach((item: any) => {
        formInputs.push({
          label: item.label[language] || item.label.en_US,
          variable: item.variable,
          type: item.type,
          required: item.required,
        })
      })
      return formInputs
    })(),
    notAuthed: isBuiltIn && !!currCollection?.allow_delete && !currCollection?.is_team_authorization,
    toolSettingSchema,
    language,
  }
}
