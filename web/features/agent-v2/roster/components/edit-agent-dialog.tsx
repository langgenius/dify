'use client'

import type { AgentAppPartial, AgentAppUpdatePayload } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFormValues, AgentIconSelection } from './agent-form'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { consoleQuery } from '@/service/client'
import { createAgentIconSelection, getAgentIconKey } from './agent-form'
import { AgentFormFields } from './agent-form-fields'

type EditAgentDialogProps = {
  agent: AgentAppPartial
  formKey: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

const applyIconPayload = (body: AgentAppUpdatePayload, icon: AgentIconSelection) => {
  if (icon.type === 'emoji') {
    body.icon_type = icon.type
    body.icon = icon.icon
    body.icon_background = icon.background
    return
  }

  body.icon_type = icon.type
  body.icon = icon.type === 'image' ? icon.fileId : icon.icon
  body.icon_background = undefined
}

export function EditAgentDialog({
  agent,
  formKey,
  open,
  onOpenChange,
}: EditAgentDialogProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [renderedFormKey, setRenderedFormKey] = useState(formKey)
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? '')
  const [role, setRole] = useState(agent.role ?? '')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [agentIcon, setAgentIcon] = useState<AgentIconSelection>(() => createAgentIconSelection(agent))
  const updateAgentMutation = useMutation(consoleQuery.agent.byAgentId.put.mutationOptions())

  if (formKey !== renderedFormKey) {
    setRenderedFormKey(formKey)
    setName(agent.name)
    setDescription(agent.description ?? '')
    setRole(agent.role ?? '')
    setIconPickerOpen(false)
    setAgentIcon(createAgentIconSelection(agent))
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setName(agent.name)
      setDescription(agent.description ?? '')
      setRole(agent.role ?? '')
      setAgentIcon(createAgentIconSelection(agent))
    }
    else {
      setIconPickerOpen(false)
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = (formValues: AgentFormValues) => {
    const trimmedName = formValues.name?.trim() ?? ''
    const trimmedDescription = formValues.description?.trim() ?? ''
    const trimmedRole = formValues.role?.trim() ?? ''
    const hasIconChanges = getAgentIconKey(agentIcon) !== getAgentIconKey(createAgentIconSelection(agent))
    const hasFormChanges = trimmedName !== agent.name.trim()
      || trimmedDescription !== (agent.description?.trim() ?? '')
      || trimmedRole !== (agent.role?.trim() ?? '')
      || hasIconChanges

    if (updateAgentMutation.isPending)
      return

    if (!hasFormChanges)
      return

    const body: AgentAppUpdatePayload = {
      name: trimmedName,
      description: trimmedDescription,
      // Keep sending the trimmed role even when empty: omitting the field
      // preserves the current backing-agent role, while "" intentionally clears it.
      role: trimmedRole,
    }

    applyIconPayload(body, agentIcon)

    updateAgentMutation.mutate({
      params: {
        agent_id: agent.id,
      },
      body,
    }, {
      onSuccess: () => {
        toast.success(t('roster.updateSuccess'))
        handleOpenChange(false)
      },
    })
  }

  const trimmedName = name.trim()
  const trimmedDescription = description.trim()
  const trimmedRole = role.trim()
  const hasIconChanges = getAgentIconKey(agentIcon) !== getAgentIconKey(createAgentIconSelection(agent))
  const hasChanges = trimmedName !== agent.name.trim()
    || trimmedDescription !== (agent.description?.trim() ?? '')
    || trimmedRole !== (agent.role?.trim() ?? '')
    || hasIconChanges

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-130 flex-col overflow-hidden! p-0!">
          <DialogCloseButton />
          <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('roster.editDialog.title')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('roster.editDialog.description')}
            </DialogDescription>
          </div>
          <Form<AgentFormValues>
            key={formKey}
            className="min-h-0 flex-1"
            onFormSubmit={handleSubmit}
          >
            <AgentFormFields
              description={description}
              icon={agentIcon}
              iconAriaLabel={t('roster.editAgent', { name: agent.name })}
              name={name}
              role={role}
              onDescriptionChange={setDescription}
              onIconClick={() => setIconPickerOpen(true)}
              onNameChange={setName}
              onRoleChange={setRole}
            />
            <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
              <Button type="button" className="min-w-18" onClick={() => handleOpenChange(false)} disabled={updateAgentMutation.isPending}>
                {tCommon('operation.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="min-w-18"
                disabled={!hasChanges}
                loading={updateAgentMutation.isPending}
              >
                {tCommon('operation.save')}
              </Button>
            </div>
          </Form>
        </DialogContent>
      </Dialog>
      <AppIconPicker
        open={iconPickerOpen}
        initialEmoji={agentIcon.type === 'emoji'
          ? { icon: agentIcon.icon, background: agentIcon.background }
          : undefined}
        onOpenChange={setIconPickerOpen}
        onSelect={setAgentIcon}
      />
    </>
  )
}
