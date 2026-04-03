import { useMutation, useQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'

export const useAvailableEvaluationMetrics = (enabled = true) => {
  return useQuery(consoleQuery.evaluation.availableMetrics.queryOptions({
    enabled,
  }))
}

export const useEvaluationNodeInfoMutation = () => {
  return useMutation(consoleQuery.evaluation.nodeInfo.mutationOptions())
}
