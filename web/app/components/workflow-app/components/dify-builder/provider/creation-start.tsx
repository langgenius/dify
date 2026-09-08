import { useAtomValue, useStore } from 'jotai'
import { useEffect } from 'react'
import { difyBuilderPendingCreationAtom } from '../creation'
import {
  difyBuilderDraftAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderStartPromptAtom,
} from '../store'

export const DifyBuilderCreationStart = ({
  appId,
  canEdit,
  canStartCreation,
  enabled,
}: {
  appId?: string
  canEdit: boolean
  canStartCreation: boolean
  enabled: boolean
}) => {
  const pendingCreation = useAtomValue(difyBuilderPendingCreationAtom)
  const store = useStore()

  useEffect(() => {
    const creation = store.get(difyBuilderPendingCreationAtom)
    if (!enabled || !canEdit || !canStartCreation || !creation || creation.appId !== appId) return

    // Consume before starting async work so remounts cannot submit the same request twice.
    store.set(difyBuilderPendingCreationAtom, null)
    const restorePrompt = () => {
      if (!store.get(difyBuilderDraftAtom)) store.set(difyBuilderDraftAtom, creation.prompt)
    }

    // Starting a session waits for the first Builder step, so keep the submitted prompt out of the draft.
    void store
      .set(difyBuilderStartPromptAtom, creation.prompt)
      .then((started) => {
        if (!started) restorePrompt()
      })
      .catch((error: unknown) => {
        restorePrompt()
        store.set(difyBuilderLocalErrorAtom, String(error))
      })
  }, [appId, canEdit, canStartCreation, enabled, pendingCreation, store])

  return null
}
