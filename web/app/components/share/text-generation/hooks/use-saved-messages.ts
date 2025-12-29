import type { SavedMessage } from '@/models/debug'
import { useCallback, useEffect, useState } from 'react'
import { fetchSavedMessage as doFetchSavedMessage, removeMessage, saveMessage } from '@/service/share'

type UseSavedMessagesParams = {
  appId: string
  isInstalledApp: boolean
  isWorkflow: boolean
  notify: (payload: { type: string, message: string }) => void
  t: (key: string, options?: Record<string, any>) => string
}

type UseSavedMessagesResult = {
  savedMessages: SavedMessage[]
  fetchSavedMessage: () => Promise<void>
  handleSaveMessage: (messageId: string) => Promise<void>
  handleRemoveSavedMessage: (messageId: string) => Promise<void>
}

export const useSavedMessages = ({
  appId,
  isInstalledApp,
  isWorkflow,
  notify,
  t,
}: UseSavedMessagesParams): UseSavedMessagesResult => {
  const [savedMessages, setSavedMessages] = useState<SavedMessage[]>([])

  const fetchSavedMessage = useCallback(async () => {
    if (!appId)
      return

    const res: any = await doFetchSavedMessage(isInstalledApp, appId)
    setSavedMessages(res.data)
  }, [appId, isInstalledApp])

  const handleSaveMessage = useCallback(async (messageId: string) => {
    if (!appId)
      return

    await saveMessage(messageId, isInstalledApp, appId)
    notify({ type: 'success', message: t('api.saved', { ns: 'common' }) })
    await fetchSavedMessage()
  }, [appId, fetchSavedMessage, isInstalledApp, notify, t])

  const handleRemoveSavedMessage = useCallback(async (messageId: string) => {
    if (!appId)
      return

    await removeMessage(messageId, isInstalledApp, appId)
    notify({ type: 'success', message: t('api.remove', { ns: 'common' }) })
    await fetchSavedMessage()
  }, [appId, fetchSavedMessage, isInstalledApp, notify, t])

  useEffect(() => {
    if (isWorkflow)
      return

    fetchSavedMessage()
  }, [fetchSavedMessage, isWorkflow])

  return {
    savedMessages,
    fetchSavedMessage,
    handleSaveMessage,
    handleRemoveSavedMessage,
  }
}
