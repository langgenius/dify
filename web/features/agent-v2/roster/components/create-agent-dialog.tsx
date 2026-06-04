'use client'

import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

type AgentFormValues = {
  description?: string
  name?: string
}

export function CreateAgentDialog() {
  const { t } = useTranslation()
  const { t: tAgentV2 } = useTranslation('agentV2')
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
        toast.success(tAgentV2('roster.createSuccess'))
        setOpen(false)
      },
      onError: () => {
        toast.error(tAgentV2('roster.createFailed'))
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="primary" className="min-w-40 gap-1.5" />}>
        <span aria-hidden className="i-ri-add-line size-4" />
        {tAgentV2('roster.createAgent')}
      </DialogTrigger>
      <DialogContent>
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {tAgentV2('roster.createDialog.title')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {tAgentV2('roster.createDialog.description')}
        </DialogDescription>
        <Form<AgentFormValues>
          className="mt-5 space-y-4"
          onFormSubmit={handleSubmit}
        >
          <FieldRoot name="name">
            <FieldLabel>
              {tAgentV2('roster.createForm.nameLabel')}
            </FieldLabel>
            <FieldControl
              autoComplete="off"
              maxLength={255}
              placeholder={tAgentV2('roster.createForm.namePlaceholder')}
              required
            />
            <FieldError match="valueMissing">
              {tAgentV2('roster.createForm.nameRequired')}
            </FieldError>
          </FieldRoot>
          <FieldRoot name="description">
            <FieldLabel>
              {tAgentV2('roster.createForm.descriptionLabel')}
            </FieldLabel>
            <Textarea
              autoComplete="off"
              placeholder={tAgentV2('roster.createForm.descriptionPlaceholder')}
            />
          </FieldRoot>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setOpen(false)} disabled={createAgentMutation.isPending}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={createAgentMutation.isPending}
            >
              {t('operation.create', { ns: 'common' })}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
