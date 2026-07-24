import { useMemo } from 'react'
import { BubbleX, Env, GlobalVariable } from '@/app/components/base/icons/src/vender/line/others'
import { InputField } from '@/app/components/base/icons/src/vender/pipeline'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { Loop } from '@/app/components/base/icons/src/vender/workflow'
import { VAR_SHOW_NAME_MAP } from '@/app/components/workflow/constants'
import { VarInInspectType } from '@/types/workflow'
import {
  isConversationVar,
  isENV,
  isGlobalVar,
  isRagVariableVar,
  isSystemVar,
} from '../utils'

export const useVarIcon = (variables: string[], variableCategory?: VarInInspectType | string) => {
  if (variableCategory === 'loop')
    return Loop

  if (variableCategory === 'rag' || isRagVariableVar(variables))
    return InputField

  if (isENV(variables) || variableCategory === VarInInspectType.environment || variableCategory === 'environment')
    return Env

  if (isConversationVar(variables) || variableCategory === VarInInspectType.conversation || variableCategory === 'conversation')
    return BubbleX

  if (isGlobalVar(variables) || variableCategory === VarInInspectType.system)
    return GlobalVariable

  return Variable02
}

export const useVarColor = (variables: string[], isExceptionVariable?: boolean, variableCategory?: VarInInspectType | string) => {
  return useMemo(() => {
    if (isExceptionVariable)
      return 'text-text-warning'

    if (variableCategory === 'loop')
      return 'text-util-colors-cyan-cyan-500'

    if (isENV(variables) || variableCategory === VarInInspectType.environment || variableCategory === 'environment')
      return 'text-util-colors-violet-violet-600'

    if (isConversationVar(variables) || variableCategory === VarInInspectType.conversation || variableCategory === 'conversation')
      return 'text-util-colors-teal-teal-700'

    if (isGlobalVar(variables) || variableCategory === VarInInspectType.system)
      return 'text-util-colors-orange-orange-600'

    return 'text-text-accent'
  }, [variables, isExceptionVariable, variableCategory])
}

export const useVarName = (variables: string[], notShowFullPath?: boolean) => {
  const showName = VAR_SHOW_NAME_MAP[variables.join('.')]
  let variableFullPathName = variables.slice(1).join('.')

  if (isRagVariableVar(variables))
    variableFullPathName = variables.slice(2).join('.')

  const varName = useMemo(() => {
    variableFullPathName = variables.slice(1).join('.')

    if (isRagVariableVar(variables))
      variableFullPathName = variables.slice(2).join('.')

    const variablesLength = variables.length
    const isSystem = isSystemVar(variables)
    const varName = notShowFullPath ? variables[variablesLength - 1] : variableFullPathName
    return `${isSystem ? 'sys.' : ''}${varName}`
  }, [variables, notShowFullPath])

  if (showName)
    return showName
  return varName
}

export const useVarBgColorInEditor = (variables: string[], hasError?: boolean) => {
  if (hasError) {
    return {
      hoverBorderColor: 'hover:border-state-destructive-active',
      hoverBgColor: 'hover:bg-state-destructive-hover',
      selectedBorderColor: '!border-state-destructive-solid',
      selectedBgColor: '!bg-state-destructive-hover',
    }
  }

  if (isENV(variables)) {
    return {
      hoverBorderColor: 'hover:border-util-colors-violet-violet-100',
      hoverBgColor: 'hover:bg-util-colors-violet-violet-50',
      selectedBorderColor: 'border-util-colors-violet-violet-600',
      selectedBgColor: 'bg-util-colors-violet-violet-50',
    }
  }

  if (isConversationVar(variables)) {
    return {
      hoverBorderColor: 'hover:border-util-colors-teal-teal-100',
      hoverBgColor: 'hover:bg-util-colors-teal-teal-50',
      selectedBorderColor: 'border-util-colors-teal-teal-600',
      selectedBgColor: 'bg-util-colors-teal-teal-50',
    }
  }

  return {
    hoverBorderColor: 'hover:border-state-accent-alt',
    hoverBgColor: 'hover:bg-state-accent-hover',
    selectedBorderColor: 'border-state-accent-solid',
    selectedBgColor: 'bg-state-accent-hover',
  }
}
