import { useAtomValue, useStore } from 'jotai'
import { useEffect } from 'react'
import { difyBuilderPendingCreationAtom } from '../creation'
import {
  difyBuilderDraftAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderRuntimeAtom,
  difyBuilderStartPromptAtom,
} from '../store'
import { useDifyBuilderModel } from '../use-dify-builder-model'

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
  const { model, isLoading } = useDifyBuilderModel({
    enabled: enabled && canEdit && pendingCreation?.appId === appId,
  })

  useEffect(() => {
    const creation = store.get(difyBuilderPendingCreationAtom)
    if (!enabled || !canEdit || !canStartCreation || !creation || creation.appId !== appId) return

    store.get(difyBuilderRuntimeAtom)?.setShowPanel(true)
    if (isLoading) return

    // Consume before starting async work so remounts cannot submit the same request twice.
    store.set(difyBuilderPendingCreationAtom, null)
    const restorePrompt = () => {
      if (!store.get(difyBuilderDraftAtom)) store.set(difyBuilderDraftAtom, creation.prompt)
    }

    if (!model || store.get(difyBuilderDraftAtom)) {
      restorePrompt()
      return
    }

    // Starting a session waits for the first Builder step, so keep the submitted prompt out of the draft.
    void store
      .set(difyBuilderStartPromptAtom, { text: creation.prompt, model })
      .then((started) => {
        if (!started) restorePrompt()
      })
      .catch((error: unknown) => {
        restorePrompt()
        store.set(difyBuilderLocalErrorAtom, String(error))
      })
  }, [appId, canEdit, canStartCreation, enabled, isLoading, model, pendingCreation, store])

  return null
}
