import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { InputVar, Node } from '@/app/components/workflow/types'
import type { EvaluationTemplateColumn } from '@/types/evaluation'
import type { SnippetInputField } from '@/types/snippet'
import { inputVarTypeToVarType } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { PipelineInputVarType } from '@/models/pipeline'

export type InputField = {
  name: string
  type: string
}

export const INDEX_FIELD_NAME = 'index'

export const getGraphNodes = (graph?: Record<string, unknown>) => {
  return Array.isArray(graph?.nodes) ? graph.nodes as Node[] : []
}

export const getStartNodeInputFields = (nodes?: Node[]): InputField[] => {
  const startNode = nodes?.find(node => node.data.type === BlockEnum.Start) as Node<StartNodeType> | undefined
  const variables = startNode?.data.variables

  if (!Array.isArray(variables))
    return []

  return variables
    .filter((variable): variable is InputVar => typeof variable.variable === 'string' && !!variable.variable)
    .map(variable => ({
      name: variable.variable,
      type: inputVarTypeToVarType(variable.type ?? InputVarType.textInput),
    }))
}

const PIPELINE_INPUT_VAR_TYPE_TO_FIELD_TYPE: Record<PipelineInputVarType, string> = {
  [PipelineInputVarType.textInput]: 'string',
  [PipelineInputVarType.paragraph]: 'string',
  [PipelineInputVarType.select]: 'string',
  [PipelineInputVarType.number]: 'number',
  [PipelineInputVarType.singleFile]: 'file',
  [PipelineInputVarType.multiFiles]: 'array[file]',
  [PipelineInputVarType.checkbox]: 'boolean',
}

export const getSnippetInputFields = (fields?: SnippetInputField[]): InputField[] => {
  if (!Array.isArray(fields))
    return []

  return fields
    .filter((field): field is SnippetInputField & { variable: string } =>
      typeof field.variable === 'string' && !!field.variable,
    )
    .map(field => ({
      name: field.variable,
      type: typeof field.type === 'string' && field.type in PIPELINE_INPUT_VAR_TYPE_TO_FIELD_TYPE
        ? PIPELINE_INPUT_VAR_TYPE_TO_FIELD_TYPE[field.type as PipelineInputVarType]
        : 'string',
    }))
}

const escapeCsvCell = (value: string) => {
  if (!/[",\n\r]/.test(value))
    return value

  return `"${value.replace(/"/g, '""')}"`
}

export const buildTemplateCsvContent = (columns: EvaluationTemplateColumn[]) => {
  return `${columns.map(column => escapeCsvCell(column.name)).join(',')}\n`
}

export const getFileExtension = (fileName: string) => {
  const extension = fileName.split('.').pop()
  return extension && extension !== fileName ? extension.toUpperCase() : ''
}

export const getExampleValue = (field: InputField, booleanLabel: string) => {
  if (field.name === INDEX_FIELD_NAME)
    return '1'

  if (field.type === 'number')
    return '0.7'

  if (field.type === 'boolean')
    return booleanLabel

  return field.name
}
