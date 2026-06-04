'use client'

import type { AgentRosterResponse } from '@dify/contracts/api/console/agents/types.gen'
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

type EditAgentDialogProps = {
  agent: AgentRosterResponse
}

type AgentFormValues = {
  description?: string
  name?: string
}

export function EditAgentDialog({
  agent,
}: EditAgentDialogProps) {
  const { t } = useTranslation()
  const { t: tAgentV2 } = useTranslation('agentV2')
  const [open, setOpen] = useState(false)
  const updateAgentMutation = useMutation(consoleQuery.agents.byAgentId.patch.mutationOptions())

  const handleSubmit = (formValues: AgentFormValues) => {
    const trimmedName = formValues.name?.trim() ?? ''
    if (!trimmedName || updateAgentMutation.isPending)
      return

    updateAgentMutation.mutate({
      params: {
        agent_id: agent.id,
      },
      body: {
        name: trimmedName,
        description: formValues.description?.trim() ?? '',
      },
    }, {
      onSuccess: () => {
        toast.success(tAgentV2('roster.updateSuccess'))
        setOpen(false)
      },
      onError: () => {
        toast.error(tAgentV2('roster.updateFailed'))
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={(
          <Button
            size="small"
            className="gap-1"
            aria-label={tAgentV2('roster.editAgent', { name: agent.name })}
          />
        )}
      >
        <span aria-hidden className="i-ri-edit-line size-3.5" />
        {t('operation.edit', { ns: 'common' })}
      </DialogTrigger>
      <DialogContent>
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {tAgentV2('roster.editDialog.title')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {tAgentV2('roster.editDialog.description')}
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
              defaultValue={agent.name}
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
              defaultValue={agent.description}
              placeholder={tAgentV2('roster.createForm.descriptionPlaceholder')}
            />
          </FieldRoot>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setOpen(false)} disabled={updateAgentMutation.isPending}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={updateAgentMutation.isPending}
            >
              {t('operation.save', { ns: 'common' })}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
