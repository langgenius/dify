import type { ExternalAgentWorkflowPreviewAgent } from './types'
import type { Field } from '@/app/components/workflow/nodes/llm/types'
import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import {
  isSpecialVar,
  matchNotSystemVars,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { VarType } from '@/app/components/workflow/types'
import { getExternalAgentDefaultInputFormats } from '../preview'

export function isExternalAgentTaskVariableSupported(
  agent: ExternalAgentWorkflowPreviewAgent,
  variable: Pick<Var, 'type'>,
) {
  const formats = getExternalAgentDefaultInputFormats(agent.key)
  if (variable.type === VarType.string) return formats.includes('Text')
  if (variable.type === VarType.file || variable.type === VarType.arrayFile)
    return formats.includes('PDF')
  return false
}

function getSchemaFieldType(field: Field): VarType {
  switch (field.type) {
    case Type.number:
      return VarType.number
    case Type.boolean:
      return VarType.boolean
    case Type.object:
      return VarType.object
    case Type.file:
      return VarType.file
    case Type.array:
      switch (field.items?.type) {
        case Type.string:
          return VarType.arrayString
        case Type.number:
          return VarType.arrayNumber
        case Type.boolean:
          return VarType.arrayBoolean
        case Type.object:
          return VarType.arrayObject
        case Type.file:
          return VarType.arrayFile
        default:
          return VarType.array
      }
    case Type.arrayString:
      return VarType.arrayString
    case Type.arrayNumber:
      return VarType.arrayNumber
    case Type.arrayObject:
      return VarType.arrayObject
    default:
      return VarType.string
  }
}

function findVariable(variables: Var[], path: string[]): Var | undefined {
  // Prefer the longest name because special variables can be stored as env.KEY or sys.query.
  for (let length = path.length; length > 0; length--) {
    const variable = variables.find((item) => item.variable === path.slice(0, length).join('.'))
    if (!variable) continue
    if (length === path.length) return variable
    const remaining = path.slice(length)
    if (Array.isArray(variable.children)) return findVariable(variable.children, remaining)
    if (!variable.children) continue

    let properties: Record<string, Field> | undefined = variable.children.schema.properties
    let field: Field | undefined
    for (const key of remaining) {
      field = properties?.[key]
      if (!field) break
      properties = field.properties
    }
    if (field) return { variable: remaining.join('.'), type: getSchemaFieldType(field) }
  }
  return undefined
}

export function resolveExternalAgentTaskVariable(
  selector: ValueSelector,
  availableVars: NodeOutPutVar[],
): Var | undefined {
  const [nodeId, ...path] = selector
  const group = availableVars.find((item) => item.nodeId === nodeId)
  if (group) {
    const variable = findVariable(group.vars, path) ?? findVariable(group.vars, selector)
    if (variable) return variable
  }
  // System, environment, conversation and RAG fields are often flattened into their group.
  if (!isSpecialVar(nodeId ?? '')) return undefined
  for (const item of availableVars) {
    const variable = findVariable(item.vars, selector)
    if (variable) return variable
  }
  return undefined
}

export function getExternalAgentTaskVariableIssues(
  agent: ExternalAgentWorkflowPreviewAgent,
  task: string,
  availableVars: NodeOutPutVar[],
) {
  return matchNotSystemVars([task]).flatMap((selector) => {
    const variable = resolveExternalAgentTaskVariable(selector, availableVars)
    // Missing references keep the existing invalid-reference diagnostic, rather than guessing a type.
    if (!variable || isExternalAgentTaskVariableSupported(agent, variable)) return []
    return [{ selector, variable: selector.slice(1).join('.'), type: variable.type }]
  })
}
