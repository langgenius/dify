'use client'

import type { CreateKnowledgeSpacePayload } from '@dify/contracts/api/console/knowledge-spaces/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldControl, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type CreateKnowledgeSpaceFormValues = {
  description?: string
  name?: string
}

type CreateKnowledgeSpaceAttempt = {
  description: string
  idempotencyKey: string
  name: string
}

function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  return `knowledge-space-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function CreateKnowledgeSpaceDialog() {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tDatasetSettings } = useTranslation('datasetSettings')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const createAttemptRef = useRef<CreateKnowledgeSpaceAttempt | null>(null)
  const createKnowledgeSpaceMutation = useMutation(
    consoleQuery.knowledgeSpaces.post.mutationOptions(),
  )

  const resetForm = () => {
    createAttemptRef.current = null
    setName('')
    setDescription('')
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) resetForm()
  }

  const handleSubmit = (values: CreateKnowledgeSpaceFormValues) => {
    if (createKnowledgeSpaceMutation.isPending) return

    const description = values.description?.trim() ?? ''
    const name = values.name?.trim() ?? ''
    const previousAttempt = createAttemptRef.current
    const idempotencyKey =
      previousAttempt?.description === description && previousAttempt.name === name
        ? previousAttempt.idempotencyKey
        : createIdempotencyKey()
    createAttemptRef.current = { description, idempotencyKey, name }

    const body = {
      description,
      idempotency_key: idempotencyKey,
      name,
    } satisfies CreateKnowledgeSpacePayload

    createKnowledgeSpaceMutation.mutate(
      { body },
      {
        onError: () => {
          toast.error(t(($) => $['newRag.createFailed']))
        },
        onSuccess: () => {
          toast.success(t(($) => $['newRag.createSuccess']))
          handleOpenChange(false)
          void queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeSpaces.get.key({ type: 'infinite' }),
          })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogTrigger render={<Button variant="primary" size="medium" className="gap-1 px-3" />}>
        <span aria-hidden className="i-ri-add-line size-4" />
        {tCommon(($) => $['operation.create'])}
      </DialogTrigger>
      <DialogContent className="w-[520px] overflow-hidden! p-0!">
        <DialogCloseButton aria-label={tCommon(($) => $['operation.close'])} />
        <div className="pt-6 pr-14 pb-3 pl-6">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['newRag.createDialogTitle'])}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t(($) => $['newRag.createDialogDescription'])}
          </DialogDescription>
        </div>
        <Form<CreateKnowledgeSpaceFormValues> onFormSubmit={handleSubmit}>
          <div className="space-y-5 px-6 py-3">
            <Field
              name="name"
              validate={(value) => {
                if (typeof value === 'string' && value.length > 0 && !value.trim())
                  return tCommon(($) => $['errorMsg.fieldRequired'], {
                    field: tDatasetSettings(($) => $['form.name']),
                  })

                return null
              }}
            >
              <FieldLabel>{tDatasetSettings(($) => $['form.name'])}</FieldLabel>
              <FieldControl
                autoComplete="off"
                // oxlint-disable-next-line jsx-a11y/no-autofocus -- The dialog opens from an explicit create command and name is its primary input.
                autoFocus
                maxLength={160}
                onValueChange={setName}
                placeholder={tDatasetSettings(($) => $['form.namePlaceholder'])}
                required
                value={name}
              />
              <FieldError match="valueMissing">
                {tCommon(($) => $['errorMsg.fieldRequired'], {
                  field: tDatasetSettings(($) => $['form.name']),
                })}
              </FieldError>
              <FieldError match="customError" />
            </Field>

            <Field name="description">
              <FieldLabel>
                {t(($) => $.externalKnowledgeDescription)}
                <span className="ml-1 system-xs-regular text-text-tertiary">
                  {tCommon(($) => $['label.optional'])}
                </span>
              </FieldLabel>
              <Textarea
                className="h-24 resize-none"
                maxLength={2000}
                onValueChange={setDescription}
                placeholder={t(($) => $.externalKnowledgeDescriptionPlaceholder)}
                value={description}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 px-6 pt-5 pb-6">
            <Button
              type="button"
              className="min-w-18"
              disabled={createKnowledgeSpaceMutation.isPending}
              onClick={() => handleOpenChange(false)}
            >
              {tCommon(($) => $['operation.cancel'])}
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="min-w-18"
              loading={createKnowledgeSpaceMutation.isPending}
            >
              {tCommon(($) => $['operation.create'])}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
