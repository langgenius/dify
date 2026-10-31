import { useMutation } from '@tanstack/react-query'
import { useErrorNotification } from '@/app/notifications/use-error-notification'
import { consoleQuery } from '@/service/console'

export function useDatasetApiKeyMutations() {
  const notifyError = useErrorNotification()
  const createKey = useMutation(
    consoleQuery.datasets.apiKeys.post.mutationOptions({ onError: notifyError }),
  )
  const deleteKey = useMutation(
    consoleQuery.datasets.apiKeys.byApiKeyId.delete.mutationOptions({ onError: notifyError }),
  )
  return { createKey, deleteKey, pending: createKey.isPending || deleteKey.isPending }
}
