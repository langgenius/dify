import { useCallback } from 'react'

export const useCondition = () => {
  const getConditionVariableType = useCallback((name: string) => {
    return name
  }, [])

  return {
    getConditionVariableType,
  }
}
