'use client'

import type { VarType as VarKindType } from '../../../tool/types'
import type { CredentialFormSchema, FormOption } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { CommonNodeType, Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'
import { VAR_SHOW_NAME_MAP } from '@/app/components/workflow/constants'
import { getNodeInfoById, isConversationVar, isENV, isGlobalVar, isRagVariableVar, isSystemVar } from './utils'

type DynamicSchemaParams = {
  dynamicOptions: FormOption[] | null
  isLoading: boolean
  schema?: Partial<CredentialFormSchema>
  value: ValueSelector | string
}

type VariableCategoryParams = {
  isChatVar: boolean
  isEnv: boolean
  isGlobal: boolean
  isLoopVar: boolean
  isRagVar: boolean
}

type OutputVarNodeParams = {
  availableNodes: Node[]
  hasValue: boolean
  isConstant: boolean
  isIterationVar: boolean
  isLoopVar: boolean
  iterationNode: Node<CommonNodeType> | null
  loopNode: Node<CommonNodeType> | null
  outputVarNodeId: string
  startNode?: Node | null
  value: ValueSelector | string
}

export const getVarKindOptions = (variableLabel = 'Variable', constantLabel = 'Constant') => ([
  { label: variableLabel, value: 'variable' as VarKindType },
  { label: constantLabel, value: 'constant' as VarKindType },
])

export const getHasValue = (isConstant: boolean, value: ValueSelector | string) =>
  !isConstant && value.length > 0

export const getIsIterationVar = (
  isInIteration: boolean,
  value: ValueSelector | string,
  parentId?: string,
) => {
  if (!isInIteration || !Array.isArray(value))
    return false
  return value[0] === parentId && ['item', 'index'].includes(value[1]!)
}

export const getIsLoopVar = (
  isInLoop: boolean,
  value: ValueSelector | string,
  parentId?: string,
) => {
  if (!isInLoop || !Array.isArray(value))
    return false
  return value[0] === parentId && ['item', 'index'].includes(value[1]!)
}

export const getOutputVarNode = ({
  availableNodes,
  hasValue,
  isConstant,
  isIterationVar,
  isLoopVar,
  iterationNode,
  loopNode,
  outputVarNodeId,
  startNode,
  value,
}: OutputVarNodeParams) => {
  if (!hasValue || isConstant)
    return null

  if (isIterationVar)
    return iterationNode?.data ?? null

  if (isLoopVar)
    return loopNode?.data ?? null

  if (isSystemVar(value as ValueSelector))
    return startNode?.data ?? null

  const node = getNodeInfoById(availableNodes, outputVarNodeId)?.data
  if (!node)
    return null

  return {
    ...node,
    id: outputVarNodeId,
  }
}

export const getVarDisplayName = (
  hasValue: boolean,
  value: ValueSelector | string,
) => {
  if (!hasValue || !Array.isArray(value))
    return ''

  const showName = VAR_SHOW_NAME_MAP[value.join('.')]
  if (showName)
    return showName

  const isSystem = isSystemVar(value)
  const varName = value[value.length - 1] ?? ''
  return `${isSystem ? 'sys.' : ''}${varName}`
}

export const getVariableMeta = (
  outputVarNode: { type?: string } | null,
  value: ValueSelector | string,
  varName: string,
  availableVars: NodeOutPutVar[] = [],
  canValidateSpecialVars = false,
) => {
  const selector = value as ValueSelector
  const isSelectorValue = Array.isArray(selector)
  const isEnv = isSelectorValue && isENV(selector)
  const isChatVar = isSelectorValue && isConversationVar(selector)
  const isGlobal = isSelectorValue && isGlobalVar(selector)
  const isRagVar = isSelectorValue && isRagVariableVar(selector)
  const isSpecialVar = isEnv || isChatVar || isRagVar
  const hasAvailableSpecialVar = !canValidateSpecialVars || !isSelectorValue || availableVars.some(nodeWithVars =>
    nodeWithVars.vars.some(variable => variable.variable === selector.join('.')),
  )
  const isValidVar = Boolean(outputVarNode) || isGlobal || (isSpecialVar && hasAvailableSpecialVar)
  return {
    isChatVar,
    isEnv,
    isGlobal,
    isRagVar,
    isValidVar,
    isException: Boolean(varName && outputVarNode?.type),
  }
}

export const getVariableCategory = ({
  isChatVar,
  isEnv,
  isGlobal,
  isLoopVar,
  isRagVar,
}: VariableCategoryParams) => {
  if (isEnv)
    return 'environment'
  if (isChatVar)
    return 'conversation'
  if (isGlobal)
    return 'global'
  if (isLoopVar)
    return 'loop'
  if (isRagVar)
    return 'rag'
  return 'system'
}

export const getWidthAllocations = (
  triggerWidth: number,
  nodeTitle: string,
  varName: string,
  type: string,
) => {
  const availableWidth = triggerWidth - 56
  const totalTextLength = (nodeTitle + varName + type).length || 1
  const priorityWidth = 15
  return {
    maxNodeNameWidth: priorityWidth + Math.floor(nodeTitle.length / totalTextLength * availableWidth),
    maxTypeWidth: Math.floor(type.length / totalTextLength * availableWidth),
    maxVarNameWidth: -priorityWidth + Math.floor(varName.length / totalTextLength * availableWidth),
  }
}

export const getDynamicSelectSchema = ({
  dynamicOptions,
  isLoading,
  schema,
  value,
}: DynamicSchemaParams) => {
  if (schema?.type !== 'dynamic-select')
    return schema

  if (dynamicOptions) {
    return {
      ...schema,
      options: dynamicOptions,
    }
  }

  if (isLoading && value && typeof value === 'string') {
    return {
      ...schema,
      options: [{
        value,
        label: { en_US: value, zh_Hans: value },
        show_on: [],
      }],
    }
  }

  return {
    ...schema,
    options: [],
  }
}

export const getTooltipContent = (
  hasValue: boolean,
  isShowAPart: boolean,
  isValidVar: boolean,
) => {
  if (isValidVar && isShowAPart)
    return 'full-path'
  if (!isValidVar && hasValue)
    return 'invalid-variable'
  return null
}

export const getOutputVarNodeId = (hasValue: boolean, value: ValueSelector | string) =>
  hasValue && Array.isArray(value) ? value[0] : ''

export const isShowAPartSelector = (value: ValueSelector | string) =>
  Array.isArray(value) && value.length > 2 && !isRagVariableVar(value)
