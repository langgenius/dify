'use client'

import { Button } from '@langgenius/dify-ui/button'
import { useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  closeCreateReleaseDialogAtom,
} from '../state'
import {
  createReleaseFormIsSubmittingAtom,
  createReleaseFormValuesAtom,
} from '../state/use-create-release-form'
import {
  createReleaseReadiness,
  useCreateReleaseSourceSelection,
  useReleaseContentCheck,
} from './use-release-content-check'

export function CreateReleaseActions() {
  const { t } = useTranslation('deployments')
  const closeDialog = useSetAtom(closeCreateReleaseDialogAtom)
  const formValues = useAtomValue(createReleaseFormValuesAtom)
  const isSubmitting = useAtomValue(createReleaseFormIsSubmittingAtom)
  const sourceSelection = useCreateReleaseSourceSelection(formValues)
  const releaseContent = useReleaseContentCheck(sourceSelection)
  const { canCreate, isCheckingReleaseContent } = createReleaseReadiness({
    formValues,
    isSubmitting,
    releaseContent,
  })

  function requestClose() {
    if (isSubmitting)
      return

    closeDialog()
  }

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
            requestClose()
          }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            requestClose()
          }}
        >
          {t('versions.cancelCreate')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="min-w-22"
          disabled={!canCreate}
        >
          {isSubmitting ? t('versions.creating') : isCheckingReleaseContent ? t('versions.checkingReleaseContent') : t('versions.create')}
        </Button>
      </div>
    </div>
  )
}
