import type { CreateExternalAPIReq } from '../declarations'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleClient, consoleQuery } from '@/service/console'

export function useSaveExternalApi(id?: string) {
  const queryClient = useQueryClient()
  const { t } = useTranslation(['common'])
  return useMutation({
    mutationFn: (body: CreateExternalAPIReq) =>
      id
        ? consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.patch(
            { params: { external_knowledge_api_id: id }, body },
            { context: { silent: true } },
          )
        : consoleClient.datasets.externalKnowledgeApi.post({ body }, { context: { silent: true } }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: consoleQuery.datasets.externalKnowledgeApi.get.key(),
      }),
    onError: () => toast.error(t(($) => $['api.actionFailed'])),
  })
}
