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
import { useAtom, useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import {
  editReleaseDialogOpenAtom,
  releaseActionItemAtom,
} from './state'

type EditReleaseFormValues = {
  name: string
  description: string
}

function normalizedEditReleaseFormValues(value: EditReleaseFormValues) {
  return {
    name: value.name.trim(),
    description: value.description.trim(),
  }
}

function canSubmitEditReleaseForm(initialValues: EditReleaseFormValues, value: EditReleaseFormValues) {
  const normalizedValues = normalizedEditReleaseFormValues(value)

  return Boolean(
    normalizedValues.name
    && (
      normalizedValues.name !== initialValues.name
      || normalizedValues.description !== initialValues.description
    ),
  )
}

function EditReleaseForm({
  release,
  isSaving,
  onClose,
  onSubmit,
}: {
  release: Release
  isSaving: boolean
  onClose: () => void
  onSubmit: (values: EditReleaseFormValues) => void
}) {
  const { t } = useTranslation('deployments')
  const nameLabel = t($ => $['versions.releaseNameLabel'])
  const initialValues = {
    name: release.displayName,
    description: release.description,
  }

  function handleSubmit(values: EditReleaseFormValues) {
    if (!canSubmitEditReleaseForm(initialValues, values))
      return

    onSubmit(normalizedEditReleaseFormValues(values))
  }

  return (
    <Form<EditReleaseFormValues> className="flex flex-col gap-4" onFormSubmit={handleSubmit}>
      <FieldRoot name="name" className="gap-2">
        <FieldLabel className="system-xs-medium-uppercase text-text-tertiary">
          {nameLabel}
        </FieldLabel>
        <FieldControl
          type="text"
          required
          defaultValue={initialValues.name}
          maxLength={128}
          autoComplete="off"
          className="h-8"
        />
        <FieldError match="valueMissing">{t($ => $['versions.releaseNameRequired'])}</FieldError>
      </FieldRoot>
      <FieldRoot name="description" className="gap-2">
        <FieldLabel className="system-xs-medium-uppercase text-text-tertiary">
          {t($ => $['versions.releaseDescriptionLabel'])}
          <span className="ml-1.5 system-xs-regular text-text-quaternary">{t($ => $['versions.optional'])}</span>
        </FieldLabel>
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
          {t($ => $['versions.cancelEdit'])}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={isSaving}
          loading={isSaving}
        >
          {t($ => $['versions.saveEdit'])}
        </Button>
      </div>
    </Form>
  )
}

export function EditReleaseDialog() {
  const { t } = useTranslation('deployments')
  const { releaseId, releaseRows } = useAtomValue(releaseActionItemAtom)
  const [open, setOpen] = useAtom(editReleaseDialogOpenAtom)
  const updateRelease = useMutation(consoleQuery.enterprise.releaseService.updateRelease.mutationOptions())
  const targetRelease = releaseRows.find(release => release.id === releaseId)
  if (!targetRelease)
    return null

  const release = targetRelease
  const formKey = `${release.id}-${release.displayName}-${release.description}`

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && updateRelease.isPending)
      return
    setOpen(nextOpen)
  }

  function handleSubmit(values: EditReleaseFormValues) {
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
          toast.success(t($ => $['versions.editSuccess'], { name: updatedName }))
          handleOpenChange(false)
        },
        onError: () => {
          toast.error(t($ => $['versions.editFailed']))
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] p-0">
        <DialogCloseButton disabled={updateRelease.isPending} />
        <div className="border-b border-divider-subtle px-6 py-5 pr-14">
          <DialogTitle className="title-xl-semi-bold text-text-primary">
            {t($ => $['versions.editRelease'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t($ => $['versions.editReleaseDescription'])}
          </DialogDescription>
        </div>
        <div className="px-6 py-5">
          <EditReleaseForm
            key={formKey}
            release={release}
            isSaving={updateRelease.isPending}
            onClose={() => handleOpenChange(false)}
            onSubmit={handleSubmit}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
