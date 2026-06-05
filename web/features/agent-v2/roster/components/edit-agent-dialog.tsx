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
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? '')
  const updateAgentMutation = useMutation(consoleQuery.agents.byAgentId.patch.mutationOptions())

  const handleSubmit = (formValues: AgentFormValues) => {
    const trimmedName = formValues.name?.trim() ?? ''
    const trimmedDescription = formValues.description?.trim() ?? ''
    const hasFormChanges = trimmedName !== agent.name.trim()
      || trimmedDescription !== (agent.description?.trim() ?? '')

    if (!trimmedName || !hasFormChanges || updateAgentMutation.isPending)
      return

    updateAgentMutation.mutate({
      params: {
        agent_id: agent.id,
      },
      body: {
        name: trimmedName,
        description: trimmedDescription,
      },
    }, {
      onSuccess: () => {
        toast.success(t('roster.updateSuccess'))
        setOpen(false)
      },
      onError: () => {
        toast.error(t('roster.updateFailed'))
      },
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setName(agent.name)
      setDescription(agent.description ?? '')
    }
    setOpen(nextOpen)
  }

  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const hasChanges = trimmedName !== agent.name.trim()
    || trimmedDescription !== (agent.description?.trim() ?? '')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={(
          <Button
            size="small"
            className="gap-1"
            aria-label={t('roster.editAgent', { name: agent.name })}
          />
        )}
      >
        <span aria-hidden className="i-ri-edit-line size-3.5" />
        {tCommon('operation.edit')}
      </DialogTrigger>
      <DialogContent>
        <DialogCloseButton />
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t('roster.editDialog.title')}
        </DialogTitle>
        <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
          {t('roster.editDialog.description')}
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
              onValueChange={setName}
              placeholder={t('roster.createForm.namePlaceholder')}
              required
              value={name}
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
              onValueChange={setDescription}
              placeholder={t('roster.createForm.descriptionPlaceholder')}
              value={description}
            />
          </FieldRoot>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setOpen(false)} disabled={updateAgentMutation.isPending}>
              {tCommon('operation.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!trimmedName || !hasChanges}
              loading={updateAgentMutation.isPending}
            >
              {tCommon('operation.save')}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
