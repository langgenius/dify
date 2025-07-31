import { useMemo } from 'react'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX, Env } from '@/app/components/base/icons/src/vender/line/others'
import {
  isConversationVar,
  isENV,
  isSystemVar,
} from '../utils'

export const useVarIcon = (variables: string[]) => {
  const isEnvVariable = isENV(variables)
  const isConversationVariable = isConversationVar(variables)

  if (isEnvVariable)
    return Env

  if (isConversationVariable)
    return BubbleX

  return Variable02
}

export const useVarColor = (variables: string[], isExceptionVariable?: boolean) => {
  return useMemo(() => {
    if (isExceptionVariable)
      return 'text-text-warning'

    if (isENV(variables))
      return 'text-util-colors-violet-violet-600'

    if (isConversationVar(variables))
      return 'text-util-colors-teal-teal-700'

    return 'text-text-accent'
  }, [variables, isExceptionVariable])
}

export const useVarName = (variables: string[], notShowFullPath?: boolean) => {
  const variableFullPathName = variables.slice(1).join('.')
  const variablesLength = variables.length
  const varName = useMemo(() => {
    const isSystem = isSystemVar(variables)
    const varName = notShowFullPath ? variables[variablesLength - 1] : variableFullPathName
    return `${isSystem ? 'sys.' : ''}${varName}`
  }, [variables, notShowFullPath])

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
