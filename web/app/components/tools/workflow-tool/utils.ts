import type {
  WorkflowToolProviderOutputParameter,
  WorkflowToolProviderOutputSchema,
} from '../types'
import { VarType } from '@/app/components/workflow/types'

const validVarTypes = new Set<string>(Object.values(VarType))

const normalizeVarType = (type?: string): VarType | undefined => {
  if (!type) return undefined

  return validVarTypes.has(type) ? (type as VarType) : undefined
}

const mergeOutputParameters = (
  outputParameters: WorkflowToolProviderOutputParameter[],
): WorkflowToolProviderOutputParameter[] => {
  const mergedParameters = new Map<string, WorkflowToolProviderOutputParameter>()

  for (const item of outputParameters) {
    const previous = mergedParameters.get(item.name)
    const typeConflict = Boolean(
      item.typeConflict || previous?.typeConflict || (previous && previous.type !== item.type),
    )

    mergedParameters.set(item.name, {
      ...item,
      ...(typeConflict ? { typeConflict: true } : {}),
    })
  }

  return [...mergedParameters.values()]
}

export const buildWorkflowOutputParameters = (
  outputParameters: WorkflowToolProviderOutputParameter[] | null | undefined,
  outputSchema?: WorkflowToolProviderOutputSchema | null,
): WorkflowToolProviderOutputParameter[] => {
  const schemaProperties = outputSchema?.properties

  if (Array.isArray(outputParameters) && outputParameters.length > 0) {
    if (!schemaProperties) return mergeOutputParameters(outputParameters)

    return mergeOutputParameters(
      outputParameters.map((item) => {
        const schema = schemaProperties[item.name]
        return {
          ...item,
          description: item.description || schema?.description || '',
          type: normalizeVarType(item.type || schema?.type),
        }
      }),
    )
  }

  if (!schemaProperties) return []

  return Object.entries(schemaProperties).map(([name, schema]) => ({
    name,
    description: schema.description || '',
    type: normalizeVarType(schema.type),
  }))
}
