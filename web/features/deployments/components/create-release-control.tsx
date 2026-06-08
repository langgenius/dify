'use client'

import type { ButtonProps } from '@langgenius/dify-ui/button'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'
import {
  CreateReleaseActions,
  ReleaseContentFeedback,
  ReleaseMetadataFields,
  ReleaseSourceSection,
} from './create-release-form-sections'
import { useCreateReleaseControl } from './use-create-release-control'

export function CreateReleaseControl({ appInstanceId, variant = 'primary', size = 'small', label, className }: {
  appInstanceId: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  label?: string
  className?: string
}) {
  const { t } = useTranslation('deployments')
  const control = useCreateReleaseControl(appInstanceId)

  return (
    <>
      <Button
        size={size}
        variant={variant}
        className={className}
        disabled={control.isCreatePending}
        onClick={control.openDialog}
      >
        {label ?? t('versions.createRelease')}
      </Button>

      <Dialog
        open={control.isCreating}
        onOpenChange={control.handleDialogOpenChange}
      >
        <DialogContent className="top-[18dvh] w-140 max-w-[calc(100vw-32px)] translate-y-0 overflow-hidden p-0">
          <DialogCloseButton
            type="button"
            disabled={control.isBusy}
            onPointerDown={control.handleClosePointerDown}
            onClick={control.handleCloseClick}
          />
          {control.isCreating && (
            <form
              noValidate
              autoComplete="off"
              onSubmit={(event) => {
                event.preventDefault()
                void control.handleCreateRelease(event.currentTarget)
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
                <ReleaseSourceSection
                  releaseSourceMode={control.releaseSourceMode}
                  selectedSourceApp={control.selectedSourceApp}
                  dslFile={control.dslFile}
                  isReadingDsl={control.isReadingDsl}
                  dslReadError={control.dslReadError}
                  hasUnsupportedDslMode={control.hasUnsupportedDslMode}
                  onReleaseSourceModeChange={control.handleReleaseSourceModeChange}
                  onSourceAppChange={control.handleSourceAppChange}
                  onDslFileChange={control.handleDslFileChange}
                />
                <ReleaseContentFeedback
                  unsupportedDslNodes={control.unsupportedDslNodes}
                  isCheckingReleaseContent={control.isCheckingReleaseContent}
                  matchedRelease={control.matchedRelease}
                  releaseContentCheckFailed={control.releaseContentCheckFailed}
                />
                <ReleaseMetadataFields
                  releaseName={control.releaseName}
                  releaseNameRequired={control.releaseNameRequired}
                  releaseDescription={control.description}
                  onReleaseNameBlur={control.handleReleaseNameBlur}
                  onReleaseNameChange={control.handleReleaseNameChange}
                  onReleaseDescriptionChange={control.setDescription}
                />
              </div>

              <CreateReleaseActions
                isCreatePending={control.isCreatePending}
                isCheckingReleaseContent={control.isCheckingReleaseContent}
                canCreate={control.canCreate}
                onCancelPointerDown={control.handleClosePointerDown}
                onCancelClick={control.handleCloseClick}
              />
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
