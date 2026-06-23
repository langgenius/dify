'use client'

import type { AgentAppCopyPayload, AgentAppPartial } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFormValues, AgentIconSelection } from './agent-form'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { consoleQuery } from '@/service/client'
import { createAgentIconSelection } from './agent-form'
import { AgentFormFields } from './agent-form-fields'

type DuplicateAgentDialogProps = {
  agent: AgentAppPartial
  formKey: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

const getDefaultCopyName = (name: string) => {
  const suffix = ' copy'
  return `${name.slice(0, 255 - suffix.length)}${suffix}`
}

export function DuplicateAgentDialog({
  agent,
  formKey,
  open,
  onOpenChange,
}: DuplicateAgentDialogProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const queryClient = useQueryClient()
  const latestAgent = queryClient.getQueryData<AgentAppPartial>(consoleQuery.agent.byAgentId.get.queryKey({
    input: {
      params: {
        agent_id: agent.id,
      },
    },
  })) ?? agent
  const [renderedFormKey, setRenderedFormKey] = useState(formKey)
  const [name, setName] = useState(() => getDefaultCopyName(latestAgent.name))
  const [description, setDescription] = useState(latestAgent.description ?? '')
  const [role, setRole] = useState(latestAgent.role ?? '')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [agentIcon, setAgentIcon] = useState<AgentIconSelection>(() => createAgentIconSelection(latestAgent))
  const duplicateAgentMutation = useMutation(consoleQuery.agent.byAgentId.copy.post.mutationOptions())

  if (formKey !== renderedFormKey) {
    setRenderedFormKey(formKey)
    setName(getDefaultCopyName(latestAgent.name))
    setDescription(latestAgent.description ?? '')
    setRole(latestAgent.role ?? '')
    setIconPickerOpen(false)
    setAgentIcon(createAgentIconSelection(latestAgent))
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const currentAgent = queryClient.getQueryData<AgentAppPartial>(consoleQuery.agent.byAgentId.get.queryKey({
        input: {
          params: {
            agent_id: agent.id,
          },
        },
      })) ?? agent
      setName(getDefaultCopyName(currentAgent.name))
      setDescription(currentAgent.description ?? '')
      setRole(currentAgent.role ?? '')
      setAgentIcon(createAgentIconSelection(currentAgent))
    }
    else {
      setIconPickerOpen(false)
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = (formValues: AgentFormValues) => {
    if (duplicateAgentMutation.isPending)
      return

    const trimmedName = formValues.name?.trim() ?? ''
    const trimmedRole = formValues.role?.trim() ?? ''
    const body: AgentAppCopyPayload = {
      name: trimmedName,
      description: formValues.description?.trim() ?? '',
      role: trimmedRole,
      icon_type: agentIcon.type,
      icon: agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon,
      icon_background: agentIcon.type === 'emoji' ? agentIcon.background : undefined,
    }

    duplicateAgentMutation.mutate({
      params: {
        agent_id: agent.id,
      },
      body,
    }, {
      onSuccess: () => {
        toast.success(t('roster.duplicateSuccess'))
        handleOpenChange(false)
      },
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-130 flex-col overflow-hidden! p-0!">
          <DialogCloseButton />
          <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('roster.duplicateDialog.title')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('roster.duplicateDialog.description', { name: latestAgent.name })}
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
              iconAriaLabel={t('roster.duplicateForm.changeIcon', { name: latestAgent.name })}
              name={name}
              role={role}
              onDescriptionChange={setDescription}
              onIconClick={() => setIconPickerOpen(true)}
              onNameChange={setName}
              onRoleChange={setRole}
            />
            <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
              <Button type="button" className="min-w-18" onClick={() => handleOpenChange(false)} disabled={duplicateAgentMutation.isPending}>
                {tCommon('operation.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="min-w-18"
                loading={duplicateAgentMutation.isPending}
              >
                {tCommon('operation.duplicate')}
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
