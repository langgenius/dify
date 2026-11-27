import type { CreateExternalAPIReq } from '../declarations'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleClient, consoleQuery } from '@/service/console'
import { getRequestErrorMessage } from '@/service/http-error'

export function useSaveExternalApi() {
  const queryClient = useQueryClient()
  const { t } = useTranslation(['common'])
  return useMutation({
    networkMode: 'always',
    meta: { errorToast: false },
    mutationFn: ({ id, body }: { id?: string; body: CreateExternalAPIReq }) =>
      id
        ? consoleClient.datasets.externalKnowledgeApi.byExternalKnowledgeApiId.patch({
            params: { external_knowledge_api_id: id },
            body,
          })
        : consoleClient.datasets.externalKnowledgeApi.post({ body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.datasets.externalKnowledgeApi.get.key(),
      })
    },
    onError: (error) =>
      toast.error(getRequestErrorMessage(error) ?? t(($) => $['api.actionFailed'])),
  })
}
