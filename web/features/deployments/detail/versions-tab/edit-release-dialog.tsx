'use client'

import type { Release } from '@dify/contracts/enterprise/types.gen'
import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type EditReleaseFormValues = {
  name: string
  description: string
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
  const initialName = release.displayName
  const initialDescription = release.description
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const normalizedName = name.trim()
  const normalizedDescription = description.trim()
  const nameRequired = !normalizedName
  const hasChanges = normalizedName !== initialName || normalizedDescription !== initialDescription
  const canSave = Boolean(!nameRequired && hasChanges && !isSaving)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSave)
      return

    onSubmit({
      name: normalizedName,
      description: normalizedDescription,
    })
  }

  return (
    <form className="flex flex-col gap-4" noValidate autoComplete="off" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-edit-name">
          {t('versions.releaseNameLabel')}
        </label>
        <Input
          id="release-edit-name"
          type="text"
          value={name}
          maxLength={128}
          autoComplete="off"
          aria-invalid={nameRequired || undefined}
          aria-describedby={nameRequired ? 'release-edit-name-error' : undefined}
          onChange={event => setName(event.target.value)}
          className="h-8"
        />
        {nameRequired && (
          <div id="release-edit-name-error" role="alert" className="system-xs-regular text-text-destructive">
            {t('versions.releaseNameRequired')}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="release-edit-description">
            {t('versions.releaseDescriptionLabel')}
          </label>
          <span className="system-xs-regular text-text-quaternary">{t('versions.optional')}</span>
        </div>
        <Textarea
          id="release-edit-description"
          value={description}
          maxLength={512}
          autoComplete="off"
          onValueChange={setDescription}
          className="min-h-24"
        />
      </div>
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
          disabled={!canSave}
          loading={isSaving}
        >
          {t('versions.saveEdit')}
        </Button>
      </div>
    </form>
  )
}

export function EditReleaseDialog({
  release,
  open,
  onOpenChange,
}: {
  release: Release
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('deployments')
  const updateRelease = useMutation(consoleQuery.enterprise.releaseService.updateRelease.mutationOptions())
  const formKey = `${release.id}-${release.displayName}-${release.description}`

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && updateRelease.isPending)
      return
    onOpenChange(nextOpen)
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
          toast.success(t('versions.editSuccess', { name: updatedName }))
          onOpenChange(false)
        },
        onError: () => {
          toast.error(t('versions.editFailed'))
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
            {t('versions.editRelease')}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t('versions.editReleaseDescription')}
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
