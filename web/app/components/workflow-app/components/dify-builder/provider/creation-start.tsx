import { useAtomValue, useStore } from 'jotai'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { difyBuilderPendingCreationAtom } from '../creation'
import { requestErrorMessage } from '../session/errors'
import {
  difyBuilderDeriveAppNameAtom,
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
  const { t } = useTranslation(['difyBuilder'])
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
    store.set(difyBuilderDeriveAppNameAtom, creation.deriveAppName ?? false)
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
      .catch(async (error: unknown) => {
        restorePrompt()
        const reason = await requestErrorMessage(error, '')
        store.set(difyBuilderLocalErrorAtom, t(($) => $.creationStartFailed, { reason }).trim())
      })
  }, [appId, canEdit, canStartCreation, enabled, isLoading, model, pendingCreation, store, t])

  return null
}
