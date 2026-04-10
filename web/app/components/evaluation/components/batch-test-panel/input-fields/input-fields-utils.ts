import type { StartNodeType } from '@/app/components/workflow/nodes/start/types'
import type { InputVar, Node } from '@/app/components/workflow/types'
import { inputVarTypeToVarType } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'

export type InputField = {
  name: string
  type: string
}

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

const escapeCsvCell = (value: string) => {
  if (!/[",\n\r]/.test(value))
    return value

  return `"${value.replace(/"/g, '""')}"`
}

export const buildTemplateCsvContent = (inputFields: InputField[]) => {
  return `${inputFields.map(field => escapeCsvCell(field.name)).join(',')}\n`
}

export const getFileExtension = (fileName: string) => {
  const extension = fileName.split('.').pop()
  return extension && extension !== fileName ? extension.toUpperCase() : ''
}

export const getExampleValue = (field: InputField, booleanLabel: string) => {
  if (field.type === 'number')
    return '0.7'

  if (field.type === 'boolean')
    return booleanLabel

  return field.name
}
