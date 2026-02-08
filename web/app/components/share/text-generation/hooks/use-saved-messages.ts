import type { SavedMessage } from '@/models/debug'
import type { AppSourceType } from '@/service/share'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Toast from '@/app/components/base/toast'
import {

  fetchSavedMessage,
  removeMessage,
  saveMessage,
} from '@/service/share'

const NAME_SPACE = 'text-generation'

export const savedMessagesQueryKeys = {
  all: (appSourceType: AppSourceType, appId: string) =>
    [NAME_SPACE, 'savedMessages', appSourceType, appId] as const,
}

export function useSavedMessages(
  appSourceType: AppSourceType,
  appId: string,
  enabled = true,
) {
  return useQuery<SavedMessage[]>({
    queryKey: savedMessagesQueryKeys.all(appSourceType, appId),
    queryFn: async () => {
      const res = await fetchSavedMessage(appSourceType, appId) as { data: SavedMessage[] }
      return res.data
    },
    enabled: enabled && !!appId,
  })
}

export function useInvalidateSavedMessages(
  appSourceType: AppSourceType,
  appId: string,
) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({
      queryKey: savedMessagesQueryKeys.all(appSourceType, appId),
    })
  }
}

export function useSaveMessageMutation(
  appSourceType: AppSourceType,
  appId: string,
) {
  const { t } = useTranslation()
  const invalidate = useInvalidateSavedMessages(appSourceType, appId)

  return useMutation({
    mutationFn: (messageId: string) =>
      saveMessage(messageId, appSourceType, appId),
    onSuccess: () => {
      Toast.notify({ type: 'success', message: t('api.saved', { ns: 'common' }) })
      invalidate()
    },
  })
}

export function useRemoveMessageMutation(
  appSourceType: AppSourceType,
  appId: string,
) {
  const { t } = useTranslation()
  const invalidate = useInvalidateSavedMessages(appSourceType, appId)

  return useMutation({
    mutationFn: (messageId: string) =>
      removeMessage(messageId, appSourceType, appId),
    onSuccess: () => {
      Toast.notify({ type: 'success', message: t('api.remove', { ns: 'common' }) })
      invalidate()
    },
  })
}
