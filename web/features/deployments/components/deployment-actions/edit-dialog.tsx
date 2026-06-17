'use client'

import type { AppInstance } from '@dify/contracts/enterprise/types.gen'
import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'

type EditDeploymentFormValues = {
  name: string
  description: string
}

function EditDeploymentFormSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SkeletonRectangle className="my-0 h-3 w-24 animate-pulse" />
        <SkeletonRectangle className="my-0 h-8 w-full animate-pulse rounded-lg" />
      </div>
      <div className="flex flex-col gap-2">
        <SkeletonRectangle className="my-0 h-3 w-28 animate-pulse" />
        <SkeletonRectangle className="my-0 h-24 w-full animate-pulse rounded-lg" />
      </div>
      <SkeletonRow className="justify-end gap-2">
        <SkeletonRectangle className="my-0 h-8 w-16 animate-pulse rounded-lg" />
        <SkeletonRectangle className="my-0 h-8 w-24 animate-pulse rounded-lg" />
      </SkeletonRow>
    </div>
  )
}

function EditDeploymentForm({
  app,
  isSaving,
  onClose,
  onSubmit,
}: {
  app: AppInstance
  isSaving: boolean
  onClose: () => void
  onSubmit: (values: EditDeploymentFormValues) => void
}) {
  const { t } = useTranslation('deployments')
  const initialName = app.displayName
  const initialDescription = app.description
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const normalizedName = name.trim()
  const normalizedDescription = description.trim()
  const canSave = Boolean(normalizedName && (normalizedName !== initialName || normalizedDescription !== initialDescription) && !isSaving)

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
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="deployment-edit-name">
          {t('settings.name')}
        </label>
        <Input
          id="deployment-edit-name"
          type="text"
          value={name}
          onChange={event => setName(event.target.value)}
          className="h-8"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="system-xs-medium-uppercase text-text-tertiary" htmlFor="deployment-edit-description">
          {t('settings.description')}
        </label>
        <Textarea
          id="deployment-edit-description"
          value={description}
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
          {t('createModal.cancel')}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!canSave}
          loading={isSaving}
        >
          {t('settings.save')}
        </Button>
      </div>
    </form>
  )
}

export function EditDeploymentDialog({
  appInstanceId,
  open,
  onOpenChange,
}: {
  appInstanceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('deployments')
  const updateInstance = useMutation(consoleQuery.enterprise.appInstanceService.updateAppInstance.mutationOptions())
  const instanceQuery = useQuery(consoleQuery.enterprise.appInstanceService.getAppInstance.queryOptions({
    input: {
      params: { appInstanceId },
    },
    enabled: open,
  }))
  const app = instanceQuery.data?.appInstance
  const formKey = app ? `${app.id}-${app.displayName}-${app.description}` : 'loading'

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && updateInstance.isPending)
      return
    onOpenChange(nextOpen)
  }

  function handleClose() {
    handleOpenChange(false)
  }

  function handleSubmit(values: EditDeploymentFormValues) {
    updateInstance.mutate(
      {
        params: {
          appInstanceId,
        },
        body: {
          appInstanceId,
          displayName: values.name,
          description: values.description || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('settings.updated'))
          onOpenChange(false)
        },
        onError: () => {
          toast.error(t('settings.updateFailed'))
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] p-0">
        <DialogCloseButton disabled={updateInstance.isPending} />
        <div className="border-b border-divider-subtle px-6 py-5">
          <DialogTitle className="title-xl-semi-bold text-text-primary">
            {t('card.menu.editInfo')}
          </DialogTitle>
        </div>
        <div className="px-6 py-5">
          {instanceQuery.isLoading
            ? <EditDeploymentFormSkeleton />
            : instanceQuery.isError
              ? <div className="system-sm-regular text-text-tertiary">{t('common.loadFailed')}</div>
              : app
                ? (
                    <EditDeploymentForm
                      key={formKey}
                      app={app}
                      isSaving={updateInstance.isPending}
                      onClose={handleClose}
                      onSubmit={handleSubmit}
                    />
                  )
                : <div className="system-sm-regular text-text-tertiary">{t('detail.notFound')}</div>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
