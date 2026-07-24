import type { WorkflowToolProviderOutputParameter, WorkflowToolProviderOutputSchema } from '../types'
import { VarType } from '@/app/components/workflow/types'

const validVarTypes = new Set<string>(Object.values(VarType))

const normalizeVarType = (type?: string): VarType | undefined => {
  if (!type)
    return undefined

  return validVarTypes.has(type) ? type as VarType : undefined
}

export const buildWorkflowOutputParameters = (
  outputParameters: WorkflowToolProviderOutputParameter[] | null | undefined,
  outputSchema?: WorkflowToolProviderOutputSchema | null,
): WorkflowToolProviderOutputParameter[] => {
  const schemaProperties = outputSchema?.properties

  if (Array.isArray(outputParameters) && outputParameters.length > 0) {
    if (!schemaProperties)
      return outputParameters

    return outputParameters.map((item) => {
      const schema = schemaProperties[item.name]
      return {
        ...item,
        description: item.description || schema?.description || '',
        type: normalizeVarType(item.type || schema?.type),
      }
    })
  }

  if (!schemaProperties)
    return []

  return Object.entries(schemaProperties).map(([name, schema]) => ({
    name,
    description: schema.description || '',
    type: normalizeVarType(schema.type),
  }))
}
