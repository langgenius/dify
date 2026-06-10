'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type AgentFormValues = {
  description?: string
  name?: string
}

export function CreateAgentDialog() {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const createAgentMutation = useMutation(consoleQuery.agents.post.mutationOptions())

  const handleSubmit = (formValues: AgentFormValues) => {
    const trimmedName = formValues.name?.trim() ?? ''
    if (!trimmedName || createAgentMutation.isPending)
      return

    createAgentMutation.mutate({
      body: {
        name: trimmedName,
        description: formValues.description?.trim() ?? '',
      },
    }, {
      onSuccess: () => {
        toast.success(t('roster.createSuccess'))
        setOpen(false)
      },
      onError: () => {
        toast.error(t('roster.createFailed'))
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div className="isolate flex h-8 items-center rounded-lg bg-components-button-primary-bg shadow-xs shadow-shadow-shadow-3">
        <DialogTrigger
          render={(
            <Button
              variant="primary"
              className="relative h-8 gap-0.5 rounded-l-lg rounded-r-none px-3 focus-visible:z-10"
            />
          )}
        >
          <span aria-hidden className="i-ri-add-line size-4" />
          <span className="px-0.5 system-sm-medium">{t('roster.createAgent')}</span>
        </DialogTrigger>
        <span aria-hidden className="h-4 w-px bg-text-primary-on-surface opacity-15" />
        <Button
          type="button"
          variant="primary"
          aria-label={t('roster.createAgentOptions')}
          className="relative size-8 rounded-l-none rounded-r-lg px-0 focus-visible:z-10"
          onClick={noop}
        >
          <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
        </Button>
      </div>
      <DialogContent>
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('roster.createDialog.title')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t('roster.createDialog.description')}
        </DialogDescription>
        <Form<AgentFormValues>
          className="mt-5 space-y-4"
          onFormSubmit={handleSubmit}
        >
          <FieldRoot name="name">
            <FieldLabel>
              {t('roster.createForm.nameLabel')}
            </FieldLabel>
            <FieldControl
              autoComplete="off"
              autoFocus
              maxLength={255}
              placeholder={t('roster.createForm.namePlaceholder')}
              required
            />
            <FieldError match="valueMissing">
              {t('roster.createForm.nameRequired')}
            </FieldError>
          </FieldRoot>
          <FieldRoot name="description">
            <FieldLabel>
              {t('roster.createForm.descriptionLabel')}
            </FieldLabel>
            <Textarea
              autoComplete="off"
              placeholder={t('roster.createForm.descriptionPlaceholder')}
            />
          </FieldRoot>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setOpen(false)} disabled={createAgentMutation.isPending}>
              {tCommon('operation.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={createAgentMutation.isPending}
            >
              {tCommon('operation.create')}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
