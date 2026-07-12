'use client'

import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldControl, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import {
  deploymentActionAppInstanceAtom,
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

function EditDeploymentForm() {
  const { t } = useTranslation('deployments')
  const nameLabel = t($ => $['settings.name'])
  const appInstance = useAtomValue(deploymentActionAppInstanceAtom)
  const appInstanceId = appInstance.id
  const initialValues = {
    name: appInstance.displayName,
    description: appInstance.description,
  }
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
          toast.success(t($ => $['settings.updated']))
          setOpen(false)
        },
        onError: () => {
          toast.error(t($ => $['settings.updateFailed']))
        },
      },
    )
  }

  return (
    <>
      <DialogCloseButton disabled={updateInstance.isPending} />
      <Form<EditDeploymentFormValues> className="flex flex-col gap-4" onFormSubmit={handleSubmit}>
        <Field name="name" className="gap-2">
          <FieldLabel className="system-xs-medium-uppercase text-text-tertiary">
            {nameLabel}
          </FieldLabel>
          <FieldControl
            type="text"
            required
            defaultValue={initialValues.name}
            className="h-8"
          />
          <FieldError match="valueMissing">{t($ => $['errorMsg.fieldRequired'], { ns: 'common', field: nameLabel })}</FieldError>
        </Field>
        <Field name="description" className="gap-2">
          <FieldLabel className="system-xs-medium-uppercase text-text-tertiary">
            {t($ => $['settings.description'])}
          </FieldLabel>
          <Textarea
            defaultValue={initialValues.description}
            className="min-h-24"
          />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            disabled={updateInstance.isPending}
            onClick={handleClose}
          >
            {t($ => $['createModal.cancel'])}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={updateInstance.isPending}
            loading={updateInstance.isPending}
          >
            {t($ => $['settings.save'])}
          </Button>
        </div>
      </Form>
    </>
  )
}

function EditDeploymentDialogContent() {
  const { t } = useTranslation('deployments')
  const appInstance = useAtomValue(deploymentActionAppInstanceAtom)

  return (
    <>
      <div className="border-b border-divider-subtle px-6 py-5">
        <DialogTitle className="title-xl-semi-bold text-text-primary">
          {t($ => $['card.menu.editInfo'])}
        </DialogTitle>
      </div>
      <div className="px-6 py-5">
        <EditDeploymentForm
          key={`${appInstance.id}-${appInstance.displayName}-${appInstance.description}`}
        />
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
