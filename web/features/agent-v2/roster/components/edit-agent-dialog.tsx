'use client'

import type { AgentRosterResponse } from '@dify/contracts/api/console/agents/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
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
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AgentFormValues = {
  description?: string
  name?: string
  role?: string
}

export function EditAgentDialog({
  agent,
  open,
  onOpenChange,
}: EditAgentDialogProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? '')
  const [role, setRole] = useState(agent.role ?? '')
  const updateAgentMutation = useMutation(consoleQuery.agents.byAgentId.patch.mutationOptions())

  const handleSubmit = (formValues: AgentFormValues) => {
    const trimmedName = formValues.name?.trim() ?? ''
    const trimmedDescription = formValues.description?.trim() ?? ''
    const trimmedRole = formValues.role?.trim() ?? ''
    const hasFormChanges = trimmedName !== agent.name.trim()
      || trimmedDescription !== (agent.description?.trim() ?? '')
      || trimmedRole !== (agent.role?.trim() ?? '')

    if (!trimmedName || !hasFormChanges || updateAgentMutation.isPending)
      return

    updateAgentMutation.mutate({
      params: {
        agent_id: agent.id,
      },
      body: {
        name: trimmedName,
        description: trimmedDescription,
        role: trimmedRole,
      },
    }, {
      onSuccess: () => {
        toast.success(t('roster.updateSuccess'))
        onOpenChange(false)
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
      setRole(agent.role ?? '')
    }
    onOpenChange(nextOpen)
  }

  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const trimmedRole = role.trim()
  const hasChanges = trimmedName !== agent.name.trim()
    || trimmedDescription !== (agent.description?.trim() ?? '')
    || trimmedRole !== (agent.role?.trim() ?? '')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
              // eslint-disable-next-line jsx-a11y/no-autofocus -- The edit dialog opens from an explicit command, and the name field is the primary editable control.
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
          <FieldRoot name="role">
            <FieldLabel>
              {t('roster.createForm.roleLabel')}
            </FieldLabel>
            <FieldControl
              autoComplete="off"
              maxLength={255}
              onValueChange={setRole}
              placeholder={t('roster.createForm.rolePlaceholder')}
              value={role}
            />
          </FieldRoot>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => onOpenChange(false)} disabled={updateAgentMutation.isPending}>
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
