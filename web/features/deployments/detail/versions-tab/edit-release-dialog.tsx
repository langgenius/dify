'use client'

import type { Release } from '@dify/contracts/enterprise/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type EditReleaseFormValues = {
  name: string
  description: string
}

function normalizedEditReleaseFormValues(values: EditReleaseFormValues) {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
  }
}

function canSubmitEditReleaseForm(initialValues: EditReleaseFormValues, values: EditReleaseFormValues) {
  const normalizedValues = normalizedEditReleaseFormValues(values)

  return Boolean(
    normalizedValues.name
    && (
      normalizedValues.name !== initialValues.name
      || normalizedValues.description !== initialValues.description
    ),
  )
}

function EditReleaseForm({
  initialValues,
  isSaving,
  onClose,
  onSubmit,
}: {
  initialValues: EditReleaseFormValues
  isSaving: boolean
  onClose: () => void
  onSubmit: (values: EditReleaseFormValues) => void
}) {
  const { t } = useTranslation('deployments')
  const nameLabel = t('versions.releaseNameLabel')
  const nameRequiredMessage = t('versions.releaseNameRequired')

  function handleSubmit(values: EditReleaseFormValues) {
    if (!canSubmitEditReleaseForm(initialValues, values))
      return

    onSubmit(normalizedEditReleaseFormValues(values))
  }

  return (
    <Form<EditReleaseFormValues> className="flex flex-col gap-4" onFormSubmit={handleSubmit}>
      <FieldRoot
        name="name"
        className="gap-2"
        validate={(value) => {
          if (typeof value === 'string' && value.length > 0 && !value.trim())
            return nameRequiredMessage

          return null
        }}
      >
        <FieldLabel className="system-xs-medium-uppercase text-text-tertiary">
          {nameLabel}
        </FieldLabel>
        <FieldControl
          type="text"
          defaultValue={initialValues.name}
          maxLength={128}
          autoComplete="off"
          required
          className="h-8"
        />
        <FieldError match="valueMissing" className="system-xs-regular">{nameRequiredMessage}</FieldError>
        <FieldError match="customError" className="system-xs-regular" />
      </FieldRoot>
      <FieldRoot name="description" className="gap-2">
        <div className="flex items-center gap-1.5">
          <FieldLabel className="system-xs-medium-uppercase text-text-tertiary">
            {t('versions.releaseDescriptionLabel')}
          </FieldLabel>
          <span className="system-xs-regular text-text-quaternary">{t('versions.optional')}</span>
        </div>
        <Textarea
          defaultValue={initialValues.description}
          maxLength={512}
          autoComplete="off"
          className="min-h-24"
        />
      </FieldRoot>
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="secondary"
          disabled={isSaving}
          onClick={onClose}
        >
          {t('versions.cancelEdit')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={isSaving}
          loading={isSaving}
        >
          {t('versions.saveEdit')}
        </Button>
      </div>
    </Form>
  )
}

function EditReleaseDialogContent({
  release,
  resetKey,
  onClose,
  onCloseBlockedChange,
}: {
  release: Release
  resetKey: number
  onClose: () => void
  onCloseBlockedChange: (blocked: boolean) => void
}) {
  const { t } = useTranslation('deployments')
  const updateRelease = useMutation(consoleQuery.enterprise.releaseService.updateRelease.mutationOptions())
  const formKey = `${resetKey}:${release.id}:${release.displayName}:${release.description}`
  const isSaving = updateRelease.isPending

  function handleClose() {
    if (isSaving)
      return

    onClose()
  }

  function handleSubmit(values: EditReleaseFormValues) {
    onCloseBlockedChange(true)
    updateRelease.mutate(
      {
        params: {
          releaseId: release.id,
        },
        body: {
          releaseId: release.id,
          displayName: values.name,
          description: values.description,
        },
      },
      {
        onSuccess: (data) => {
          const updatedName = data.release.displayName
          toast.success(t('versions.editSuccess', { name: updatedName }))
          onClose()
        },
        onError: () => {
          toast.error(t('versions.editFailed'))
        },
        onSettled: () => {
          onCloseBlockedChange(false)
        },
      },
    )
  }

  return (
    <>
      <DialogCloseButton disabled={isSaving} />
      <div className="border-b border-divider-subtle px-6 py-5 pr-14">
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {t('versions.editRelease')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t('versions.editReleaseDescription')}
        </DialogDescription>
      </div>
      <div className="px-6 py-5">
        <EditReleaseForm
          key={formKey}
          initialValues={{
            name: release.displayName,
            description: release.description,
          }}
          isSaving={isSaving}
          onClose={handleClose}
          onSubmit={handleSubmit}
        />
      </div>
    </>
  )
}

export function EditReleaseDialog({
  release,
  open,
  resetKey,
  onOpenChange,
}: {
  release: Release
  open: boolean
  resetKey: number
  onOpenChange: (open: boolean) => void
}) {
  const closeBlockedRef = useRef(false)
  const [closeBlocked, setCloseBlocked] = useState(false)

  function handleCloseBlockedChange(blocked: boolean) {
    closeBlockedRef.current = blocked
    setCloseBlocked(blocked)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && closeBlockedRef.current)
      return

    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} disablePointerDismissal={closeBlocked} onOpenChange={handleOpenChange}>
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] p-0">
        <EditReleaseDialogContent
          release={release}
          resetKey={resetKey}
          onClose={() => onOpenChange(false)}
          onCloseBlockedChange={handleCloseBlockedChange}
        />
      </DialogContent>
    </Dialog>
  )
}
