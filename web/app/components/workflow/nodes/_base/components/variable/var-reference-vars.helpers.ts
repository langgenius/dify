import type { NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { VAR_SHOW_NAME_MAP } from '@/app/components/workflow/constants'
import { checkKeys } from '@/utils/var'
import { isSpecialVar } from './utils'

export const getVariableDisplayName = (
  variable: string,
  isFlat: boolean,
  isInCodeGeneratorInstructionEditor?: boolean,
) => {
  if (VAR_SHOW_NAME_MAP[variable])
    return VAR_SHOW_NAME_MAP[variable]
  if (!isFlat)
    return variable
  if (variable === 'current')
    return isInCodeGeneratorInstructionEditor ? 'current_code' : 'current_prompt'
  return variable
}

export const getVariableCategory = ({
  isEnv,
  isChatVar,
  isLoopVar,
  isRagVariable,
}: {
  isEnv: boolean
  isChatVar: boolean
  isLoopVar?: boolean
  isRagVariable?: boolean
}) => {
  if (isEnv)
    return 'environment'
  if (isChatVar)
    return 'conversation'
  if (isLoopVar)
    return 'loop'
  if (isRagVariable)
    return 'rag'
  return 'system'
}

export const getValueSelector = ({
  itemData,
  isFlat,
  isSupportFileVar,
  isFile,
  isSys,
  isEnv,
  isChatVar,
  isRagVariable,
  nodeId,
  objPath,
}: {
  itemData: Var
  isFlat?: boolean
  isSupportFileVar?: boolean
  isFile: boolean
  isSys: boolean
  isEnv: boolean
  isChatVar: boolean
  isRagVariable?: boolean
  nodeId: string
  objPath: string[]
}): ValueSelector | undefined => {
  if (!isSupportFileVar && isFile)
    return undefined

  if (isFlat)
    return [itemData.variable]
  if (isSys || isEnv || isChatVar || isRagVariable)
    return [...objPath, ...itemData.variable.split('.')]
  return [nodeId, ...objPath, itemData.variable]
}

const getVisibleChildren = (vars: Var[]) => {
  return vars.filter(variable => checkKeys([variable.variable], false).isValid || isSpecialVar(variable.variable.split('.')[0]))
}

export const filterReferenceVars = (vars: NodeOutPutVar[], searchText: string) => {
  const searchTextLower = searchText.toLowerCase()

  return vars
    .map(node => ({ ...node, vars: getVisibleChildren(node.vars) }))
    .filter(node => node.vars.length > 0)
    .filter((node) => {
      if (!searchText)
        return true
      return node.vars.some(variable => variable.variable.toLowerCase().includes(searchTextLower))
        || node.title.toLowerCase().includes(searchTextLower)
    })
    .map((node) => {
      if (!searchText || node.title.toLowerCase().includes(searchTextLower))
        return node

      return {
        ...node,
        vars: node.vars.filter(variable => variable.variable.toLowerCase().includes(searchTextLower)),
      }
    })
}
