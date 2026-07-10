'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  createReleaseContentReadyAtom,
  createReleaseFormIsSubmittingAtom,
  createReleaseHasNameConflictAtom,
  createReleaseNameFieldAtom,
  isCheckingCreateReleaseContentAtom,
  requestCloseCreateReleaseDialogAtom,
} from '../state'

export function CreateReleaseActions() {
  const { t } = useTranslation('deployments')
  const requestCloseDialog = useSetAtom(requestCloseCreateReleaseDialogAtom)
  const isSubmitting = useAtomValue(createReleaseFormIsSubmittingAtom)
  const releaseContentReady = useAtomValue(createReleaseContentReadyAtom)
  const isCheckingReleaseContent = useAtomValue(isCheckingCreateReleaseContentAtom)
  const hasReleaseNameConflict = useAtomValue(createReleaseHasNameConflictAtom)
  const releaseNameField = useAtomValue(createReleaseNameFieldAtom)
  const hasReleaseName = Boolean(releaseNameField.value.trim())

  return (
    <div className="flex items-center justify-end gap-4 border-t border-divider-subtle bg-background-default-subtle px-6 py-4">
      <div className="flex shrink-0 justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={isSubmitting}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            requestCloseDialog()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            requestCloseDialog()
          }}
        >
          {t($ => $['versions.cancelCreate'])}
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="min-w-22"
          disabled={!hasReleaseName || !releaseContentReady || hasReleaseNameConflict}
          loading={isSubmitting}
        >
          {isSubmitting ? t($ => $['versions.creating']) : isCheckingReleaseContent ? t($ => $['versions.checkingReleaseContent']) : t($ => $['versions.create'])}
        </Button>
      </div>
    </div>
  )
}
