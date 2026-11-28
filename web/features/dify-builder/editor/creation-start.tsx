import { useAtomValue, useStore } from 'jotai'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { pendingBuilderPromptAtom } from '../creation/pending-prompt'
import { useDifyBuilderModel } from '../model/use-model'
import { requestErrorMessage } from '../session/errors'
import {
  difyBuilderDraftAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderRuntimeAtom,
  difyBuilderSendDraftAtom,
} from '../state'

export function DifyBuilderCreationStart({ appId, ready }: { appId?: string; ready: boolean }) {
  const { t } = useTranslation(['difyBuilder'])
  const pending = useAtomValue(pendingBuilderPromptAtom)
  const store = useStore()
  const belongsToApp = !!appId && pending?.appId === appId
  const { model, isLoading } = useDifyBuilderModel({ enabled: ready && belongsToApp })

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    // The editor's shared draft-save hook finishes mounting before this handoff runs.
    queueMicrotask(() => {
      if (cancelled) return
      const handoff = store.get(pendingBuilderPromptAtom)
      const runtime = store.get(difyBuilderRuntimeAtom)
      if (!handoff || handoff.appId !== appId || !runtime?.canEdit || !runtime.enabled) return
      runtime.setShowPanel(true)
      if (isLoading) return

      // Claim the handoff synchronously so reopening or remounting cannot send it twice.
      store.set(pendingBuilderPromptAtom, null)
      const restorePrompt = () => {
        if (!store.get(difyBuilderDraftAtom)) store.set(difyBuilderDraftAtom, handoff.prompt)
      }
      if (!model || store.get(difyBuilderDraftAtom)) {
        restorePrompt()
        return
      }
      void store
        .set(difyBuilderSendDraftAtom, model, { attachments: [], text: handoff.prompt })
        .then((started) => {
          if (!started) restorePrompt()
        })
        .catch(async (error: unknown) => {
          restorePrompt()
          const reason = await requestErrorMessage(error, '')
          store.set(difyBuilderLocalErrorAtom, t(($) => $.creationStartFailed, { reason }).trim())
        })
    })
    return () => {
      cancelled = true
    }
  }, [appId, isLoading, model, pending, ready, store, t])

  return null
}
