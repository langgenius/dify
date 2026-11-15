import { useMutation } from '@tanstack/react-query'
import { consoleQuery } from '@/service/console'

export function useDatasetApiKeyMutations() {
  const createKey = useMutation(consoleQuery.datasets.apiKeys.post.mutationOptions())
  const deleteKey = useMutation(consoleQuery.datasets.apiKeys.byApiKeyId.delete.mutationOptions())
  return { createKey, deleteKey, pending: createKey.isPending || deleteKey.isPending }
}
