'use client'

import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import { deploymentErrorMessage } from '../../shared/domain/error'
import {
  closeCreateReleaseDialogAtom,
  createReleaseDialogOpenAtom,
  createReleaseFormAtom,
  createReleaseFormIsSubmittingAtom,
  CreateReleaseSubmissionBlockedError,
  openCreateReleaseDialogAtom,
  submitCreateReleaseFormAtom,
} from '../state'
import { CreateReleaseActions } from './actions'
import { ReleaseContentFeedback } from './content-feedback'
import { ReleaseMetadataFields } from './metadata-fields'
import { ReleaseSourceSection } from './source-section'

function CreateReleaseCloseButton({ isSubmitting }: {
  isSubmitting: boolean
}) {
  const closeDialog = useSetAtom(closeCreateReleaseDialogAtom)

  function requestClose() {
    if (isSubmitting)
      return

    closeDialog()
  }

  return (
    <DialogCloseButton
      type="button"
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
    />
  )
}

function CreateReleaseDialogForm() {
  return (
    <ScopeProvider atoms={[createReleaseFormAtom]}>
      <CreateReleaseDialogSurface />
    </ScopeProvider>
  )
}

function CreateReleaseDialogSurface() {
  const open = useAtomValue(createReleaseDialogOpenAtom)
  const isSubmitting = useAtomValue(createReleaseFormIsSubmittingAtom)
  const openDialog = useSetAtom(openCreateReleaseDialogAtom)
  const closeDialog = useSetAtom(closeCreateReleaseDialogAtom)
  const submitCreateReleaseForm = useSetAtom(submitCreateReleaseFormAtom)
  const { t } = useTranslation('deployments')

  function handleDialogOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      openDialog()
      return
    }

    if (!isSubmitting)
      closeDialog()
  }

  async function handleSubmit() {
    try {
      const response = await submitCreateReleaseForm()
      if (!response)
        return

      toast.success(t('versions.createSuccess', { name: response.release.displayName }))
      closeDialog()
    }
    catch (error) {
      if (error instanceof CreateReleaseSubmissionBlockedError) {
        toast.error(t('versions.dslUnsupportedMode'))
        return
      }

      const message = await deploymentErrorMessage(error)
      toast.error(message || t('versions.createFailed'))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleDialogOpenChange}
    >
      <DialogContent className="top-[18dvh] w-140 max-w-[calc(100vw-32px)] translate-y-0 overflow-hidden p-0">
        <CreateReleaseCloseButton isSubmitting={isSubmitting} />
        <form
          noValidate
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void handleSubmit()
          }}
        >
          <div className="border-b border-divider-subtle px-6 py-5 pr-14">
            <div className="min-w-0">
              <DialogTitle className="title-xl-semi-bold text-text-primary">
                {t('versions.createRelease')}
              </DialogTitle>
              <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
                {t('versions.createReleaseDescription')}
              </DialogDescription>
            </div>
          </div>

          <div className="flex flex-col gap-5 px-6 py-5">
            <ReleaseSourceSection />
            <ReleaseContentFeedback />
            <ReleaseMetadataFields />
          </div>

          <CreateReleaseActions />
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CreateReleaseDialog() {
  const open = useAtomValue(createReleaseDialogOpenAtom)

  if (!open)
    return null

  return <CreateReleaseDialogForm />
}
