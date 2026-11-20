import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { editorAppIdAtom } from '@/app/components/workflow/editor-resource/state'
import { consoleClient } from '@/service/console'
import { useStore, useWorkflowStore } from '../store'

/**
 * The app's mentionable users, loaded once per app into the workflow store.
 * Anything that renders or inserts mentions reads them through this hook so the
 * list is there the first time it is needed, not only after a composer mounts.
 */
export function useMentionableUsers() {
  const appId = useAtomValue(editorAppIdAtom)
  const workflowStore = useWorkflowStore()
  const users = useStore((state) => (appId ? state.mentionableUsersCache[appId] : undefined))

  useEffect(() => {
    if (!appId) return
    const state = workflowStore.getState()
    if (state.mentionableUsersCache[appId] !== undefined || state.mentionableUsersLoading[appId])
      return

    state.setMentionableUsersLoading(appId, true)
    consoleClient.apps.byAppId.workflow.comments.mentionUsers
      .get({ params: { app_id: appId } })
      .then((response) => workflowStore.getState().setMentionableUsersCache(appId, response.users))
      .catch((error) => console.error('Failed to load mentionable users:', error))
      .finally(() => workflowStore.getState().setMentionableUsersLoading(appId, false))
  }, [appId, workflowStore])

  return users
}
