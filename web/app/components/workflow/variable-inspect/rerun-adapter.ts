import type { RerunVariableMeta } from '../store/workflow/panel-slice'
import type { VarType } from '../types'
import type {
  CommonNodeType,
  NodeProps,
} from '@/app/components/workflow/types'
import type {
  GetRerunVariablesResponse,
  RerunVariableGroupName,
  RerunVariableItem,
} from '@/service/workflow-rerun'
import type {
  NodeWithVar,
  VarInInspect,
} from '@/types/workflow'
import { BlockEnum, VarType as WorkflowVarType } from '@/app/components/workflow/types'
import { VarInInspectType } from '@/types/workflow'

export const RERUN_MASK_PLACEHOLDER = '******************'

type AdaptRerunVariablesResult = {
  nodeGroups: NodeWithVar[]
  envVars: VarInInspect[]
  originalValueByVarId: Record<string, unknown>
  currentValueByVarId: Record<string, unknown>
  metaByVarId: Record<string, RerunVariableMeta>
}

export type RerunNodeMeta = {
  nodeId: string
  title: string
  nodeType: BlockEnum
  nodePayload: CommonNodeType
}

const AVAILABLE_VAR_TYPES = new Set<string>(Object.values(WorkflowVarType))

const normalizeDeclaredTypeToVarType = (declaredType: string | null): VarType => {
  switch (declaredType) {
    case 'text-input':
    case 'paragraph':
    case 'select':
    case 'external_data_tool':
      return WorkflowVarType.string
    case 'number':
      return WorkflowVarType.number
    case 'checkbox':
      return WorkflowVarType.boolean
    case 'file':
      return WorkflowVarType.file
    case 'file-list':
      return WorkflowVarType.arrayFile
    case 'json_object':
      return WorkflowVarType.object
    default:
      return WorkflowVarType.object
  }
}

const normalizeVarType = (valueType: string, declaredType: string | null): VarType => {
  if (valueType === 'none')
    return normalizeDeclaredTypeToVarType(declaredType)

  if (AVAILABLE_VAR_TYPES.has(valueType))
    return valueType as VarType

  return WorkflowVarType.object
}

const normalizeValue = (value: unknown, valueType: VarType): unknown => {
  switch (valueType) {
    case WorkflowVarType.boolean:
      if (typeof value === 'boolean')
        return value
      if (value === null || value === undefined)
        return null
      return false
    case WorkflowVarType.number:
    case WorkflowVarType.integer:
      if (typeof value === 'number')
        return value
      if (value === null || value === undefined)
        return null
      return Number.isNaN(Number(value)) ? null : Number(value)
    case WorkflowVarType.file:
      if (!value || typeof value !== 'object')
        return null
      return value
    case WorkflowVarType.array:
    case WorkflowVarType.arrayAny:
    case WorkflowVarType.arrayBoolean:
    case WorkflowVarType.arrayFile:
    case WorkflowVarType.arrayNumber:
    case WorkflowVarType.arrayObject:
    case WorkflowVarType.arrayString:
      return Array.isArray(value) ? value : []
    case WorkflowVarType.object:
      if (value === null || value === undefined)
        return null
      if (typeof value === 'object' && !Array.isArray(value))
        return value
      return null
    default:
      return value ?? null
  }
}

const buildNodeGroupId = (group: RerunVariableGroupName, selectorHead: string, index: number) => {
  if (group === 'start_node_variables')
    return 'rerun:start_node_variables'

  if (!selectorHead)
    return `rerun:${group}:unknown:${index}`

  return `rerun:${group}:${selectorHead}`
}

const buildVar = (group: RerunVariableGroupName, item: RerunVariableItem): {
  varData?: VarInInspect
  meta?: RerunVariableMeta
  originalValue?: unknown
} => {
  if (!item.selector?.length)
    return {}

  const name = item.selector[item.selector.length - 1]
  if (!name)
    return {}

  const id = `rerun:${group}:${item.selector.join('.')}`
  const normalizedValueType = normalizeVarType(item.value_type, item.declared_type)
  const hasRawValue = Object.prototype.hasOwnProperty.call(item, 'value')
  const normalizedValue = item.value_type === 'none' && !hasRawValue
    ? null
    : normalizeValue(item.value, normalizedValueType)

  return {
    varData: {
      id,
      type: group === 'environment_variables' || item.selector[0] === VarInInspectType.environment
        ? VarInInspectType.environment
        : VarInInspectType.node,
      name,
      description: '',
      selector: item.selector,
      value_type: normalizedValueType,
      value: normalizedValue,
      edited: false,
      visible: true,
      is_truncated: false,
      full_content: {
        size_bytes: 0,
        download_url: '',
      },
    },
    meta: {
      group,
      declaredType: item.declared_type,
      required: item.required,
      masked: item.masked,
      rawValueType: item.value_type,
    },
    originalValue: normalizedValue,
  }
}

const getFallbackNodePayload = (title: string, type: BlockEnum): NodeProps['data'] => ({
  title,
  desc: '',
  type,
})

export const adaptRerunVariables = (
  payload: GetRerunVariablesResponse,
  nodeMetaById: Record<string, RerunNodeMeta> = {},
): AdaptRerunVariablesResult => {
  const envVars: VarInInspect[] = []
  const nodeGroupsMap = new Map<string, NodeWithVar>()
  const originalValueByVarId: Record<string, unknown> = {}
  const currentValueByVarId: Record<string, unknown> = {}
  const metaByVarId: Record<string, RerunVariableMeta> = {}

  payload.groups?.forEach((groupItem, groupIndex) => {
    groupItem.variables?.forEach((variable) => {
      const built = buildVar(groupItem.group, variable)
      if (!built.varData || !built.meta)
        return

      const { varData, meta, originalValue } = built
      originalValueByVarId[varData.id] = originalValue
      currentValueByVarId[varData.id] = originalValue
      metaByVarId[varData.id] = meta

      if (groupItem.group === 'environment_variables') {
        envVars.push(varData)
        return
      }

      const selectorHead = variable.selector[0] || ''
      const nodeGroupId = buildNodeGroupId(groupItem.group, selectorHead, groupIndex)
      const existed = nodeGroupsMap.get(nodeGroupId)
      if (existed) {
        existed.vars.push(varData)
        return
      }

      const isStartGroup = groupItem.group === 'start_node_variables'
      const rerunNodeMeta = nodeMetaById[selectorHead]
      const title = rerunNodeMeta?.title || (isStartGroup ? 'Start' : (selectorHead || 'Node'))
      const nodeType = rerunNodeMeta?.nodeType || (isStartGroup ? BlockEnum.Start : BlockEnum.VariableAssigner)
      const nodePayload = rerunNodeMeta?.nodePayload || getFallbackNodePayload(title, nodeType)
      nodeGroupsMap.set(nodeGroupId, {
        nodeId: rerunNodeMeta?.nodeId || (isStartGroup ? 'start' : (selectorHead || nodeGroupId)),
        nodePayload,
        nodeType,
        title,
        vars: [varData],
        isValueFetched: true,
      })
    })
  })

  return {
    nodeGroups: Array.from(nodeGroupsMap.values()),
    envVars,
    originalValueByVarId,
    currentValueByVarId,
    metaByVarId,
  }
}
