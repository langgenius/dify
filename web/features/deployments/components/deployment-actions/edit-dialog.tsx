'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle, SkeletonRow } from '@/app/components/base/skeleton'
import { consoleQuery } from '@/service/client'
import {
  deploymentActionAppInstanceIdAtom,
  deploymentActionAppInstanceQueryAtom,
  editDeploymentDialogOpenAtom,
} from './state'

type EditDeploymentFormValues = {
  name: string
  description: string
}

function normalizedEditDeploymentFormValues(value: EditDeploymentFormValues) {
  return {
    name: value.name.trim(),
    description: value.description.trim(),
  }
}

function canSubmitEditDeploymentForm(initialValues: EditDeploymentFormValues, value: EditDeploymentFormValues) {
  const normalizedValues = normalizedEditDeploymentFormValues(value)

  return Boolean(
    normalizedValues.name
    && (
      normalizedValues.name !== initialValues.name
      || normalizedValues.description !== initialValues.description
    ),
  )
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
  initialValues,
}: {
  initialValues: EditDeploymentFormValues
}) {
  const { t } = useTranslation('deployments')
  const nameLabel = t('settings.name')
  const appInstanceId = useAtomValue(deploymentActionAppInstanceIdAtom)
  const setOpen = useSetAtom(editDeploymentDialogOpenAtom)
  const updateInstance = useMutation(consoleQuery.enterprise.appInstanceService.updateAppInstance.mutationOptions())

  function handleClose() {
    if (updateInstance.isPending)
      return

    setOpen(false)
  }

  function handleSubmit(values: EditDeploymentFormValues) {
    if (!canSubmitEditDeploymentForm(initialValues, values))
      return

    const normalizedValues = normalizedEditDeploymentFormValues(values)

    updateInstance.mutate(
      {
        params: {
          appInstanceId,
        },
        body: {
          appInstanceId,
          displayName: normalizedValues.name,
          description: normalizedValues.description,
        },
      },
      {
        onSuccess: () => {
          toast.success(t('settings.updated'))
          setOpen(false)
        },
        onError: () => {
          toast.error(t('settings.updateFailed'))
        },
      },
    )
  }

  return (
    <>
      <DialogCloseButton disabled={updateInstance.isPending} />
      <Form<EditDeploymentFormValues> className="flex flex-col gap-4" onFormSubmit={handleSubmit}>
        <FieldRoot name="name" className="gap-2">
          <FieldLabel className="system-xs-medium-uppercase text-text-tertiary">
            {nameLabel}
          </FieldLabel>
          <FieldControl
            type="text"
            required
            defaultValue={initialValues.name}
            className="h-8"
          />
          <FieldError match="valueMissing">{t('errorMsg.fieldRequired', { ns: 'common', field: nameLabel })}</FieldError>
        </FieldRoot>
        <FieldRoot name="description" className="gap-2">
          <FieldLabel className="system-xs-medium-uppercase text-text-tertiary">
            {t('settings.description')}
          </FieldLabel>
          <Textarea
            defaultValue={initialValues.description}
            className="min-h-24"
          />
        </FieldRoot>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            disabled={updateInstance.isPending}
            onClick={handleClose}
          >
            {t('createModal.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={updateInstance.isPending}
            loading={updateInstance.isPending}
          >
            {t('settings.save')}
          </Button>
        </div>
      </Form>
    </>
  )
}

function EditDeploymentDialogContent() {
  const { t } = useTranslation('deployments')
  const instanceQuery = useAtomValue(deploymentActionAppInstanceQueryAtom)
  const app = instanceQuery.data?.appInstance

  return (
    <>
      {!app && <DialogCloseButton />}
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
                    key={`${app.id}-${app.displayName}-${app.description}`}
                    initialValues={{
                      name: app.displayName,
                      description: app.description,
                    }}
                  />
                )
              : <div className="system-sm-regular text-text-tertiary">{t('detail.notFound')}</div>}
      </div>
    </>
  )
}

export function EditDeploymentDialog() {
  const [open, setOpen] = useAtom(editDeploymentDialogOpenAtom)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-120 max-w-[calc(100vw-32px)] p-0">
        <EditDeploymentDialogContent />
      </DialogContent>
    </Dialog>
  )
}
