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
  if (Array.isArray(outputParameters))
    return outputParameters

  if (!outputSchema?.properties)
    return []

  return Object.entries(outputSchema.properties).map(([name, schema]) => ({
    name,
    description: schema.description,
    type: normalizeVarType(schema.type),
  }))
}
