import type {
  WorkflowToolOutputSource,
  WorkflowToolProviderOutputParameter,
  WorkflowToolProviderOutputSchema,
} from '../types'
import { VarType } from '@/app/components/workflow/types'
import { normalizeWorkflowOutputName } from '@/app/components/workflow/utils/variable'

const validVarTypes = new Set<string>(Object.values(VarType))

const normalizeVarType = (type?: string): VarType | undefined => {
  if (!type) return undefined

  return validVarTypes.has(type) ? (type as VarType) : undefined
}

export const getUniqueWorkflowOutputSources = (
  outputParameters: readonly WorkflowToolProviderOutputParameter[],
): WorkflowToolOutputSource[] => {
  const sources: WorkflowToolOutputSource[] = []
  const sourceNodeIds = new Set<string>()

  for (const output of outputParameters) {
    const source = output.source
    if (!source || sourceNodeIds.has(source.nodeId)) continue

    sourceNodeIds.add(source.nodeId)
    sources.push(source)
  }

  return sources
}

export const getSourceNodeDisplayName = (
  source: WorkflowToolOutputSource,
  duplicateSources: readonly WorkflowToolOutputSource[],
) => {
  const title = source.nodeTitle || source.nodeId
  if (!source.nodeTitle) return title

  let sameTitleSourceCount = 0
  let sourceIndex = -1

  for (const candidate of duplicateSources) {
    if (candidate.nodeTitle !== source.nodeTitle) continue

    if (candidate.nodeId === source.nodeId) sourceIndex = sameTitleSourceCount
    sameTitleSourceCount += 1
  }

  if (sameTitleSourceCount < 2 || sourceIndex < 0) return title

  return `${title} (${sourceIndex + 1}/${sameTitleSourceCount})`
}

export const getDuplicateWorkflowOutputGroups = (
  outputParameters: WorkflowToolProviderOutputParameter[],
) => {
  const groups = new Map<string, WorkflowToolProviderOutputParameter[]>()

  for (const item of outputParameters) {
    const name = normalizeWorkflowOutputName(item.name)
    if (!name) continue

    const group = groups.get(name) || []
    group.push(item)
    groups.set(name, group)
  }

  return new Map([...groups].filter(([, items]) => items.length > 1))
}

export const buildWorkflowOutputParameters = (
  outputParameters: WorkflowToolProviderOutputParameter[] | null | undefined,
  outputSchema?: WorkflowToolProviderOutputSchema | null,
): WorkflowToolProviderOutputParameter[] => {
  const schemaProperties = outputSchema?.properties

  if (Array.isArray(outputParameters) && outputParameters.length > 0) {
    if (!schemaProperties) return outputParameters

    return outputParameters.map((item) => {
      const schema = schemaProperties[item.name]
      return {
        ...item,
        description: item.description || schema?.description || '',
        type: normalizeVarType(item.type || schema?.type),
      }
    })
  }

  if (!schemaProperties) return []

  return Object.entries(schemaProperties).map(([name, schema]) => ({
    name,
    description: schema.description || '',
    type: normalizeVarType(schema.type),
  }))
}
