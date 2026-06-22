'use client'

import type { AgentAppPartial, CopyAppPayload } from '@dify/contracts/api/console/agent/types.gen'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldDescription, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { consoleQuery } from '@/service/client'

type DuplicateAgentDialogProps = {
  agent: AgentAppPartial
  open: boolean
  onOpenChange: (open: boolean) => void
}

type DuplicateAgentFormValues = {
  description?: string
  name?: string
}

type AgentIconSelection = AppIconSelection | {
  type: 'link'
  icon: string
  url: string
}

const defaultAgentIcon = {
  type: 'emoji',
  icon: '🧸',
  background: '#F5F3FF',
} satisfies AppIconSelection

const createAgentIconSelection = (agent: AgentAppPartial): AgentIconSelection => {
  if (agent.icon_type === 'image' && agent.icon) {
    return {
      type: 'image',
      fileId: agent.icon,
      url: agent.icon,
    }
  }

  if (agent.icon_type === 'link' && agent.icon) {
    return {
      type: 'link',
      icon: agent.icon,
      url: agent.icon,
    }
  }

  return {
    type: 'emoji',
    icon: agent.icon || defaultAgentIcon.icon,
    background: agent.icon_background || defaultAgentIcon.background,
  }
}

const getDefaultCopyName = (name: string) => {
  const suffix = ' copy'
  return `${name.slice(0, 255 - suffix.length)}${suffix}`
}

export function DuplicateAgentDialog({
  agent,
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
  const [name, setName] = useState('')
  const [description, setDescription] = useState(latestAgent.description ?? '')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [agentIcon, setAgentIcon] = useState<AgentIconSelection>(() => createAgentIconSelection(latestAgent))
  const duplicateAgentMutation = useMutation(consoleQuery.agent.byAgentId.copy.post.mutationOptions())
  const defaultCopyName = getDefaultCopyName(latestAgent.name)

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const currentAgent = queryClient.getQueryData<AgentAppPartial>(consoleQuery.agent.byAgentId.get.queryKey({
        input: {
          params: {
            agent_id: agent.id,
          },
        },
      })) ?? agent
      setName('')
      setDescription(currentAgent.description ?? '')
      setAgentIcon(createAgentIconSelection(currentAgent))
    }
    else {
      setIconPickerOpen(false)
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = (formValues: DuplicateAgentFormValues) => {
    if (duplicateAgentMutation.isPending)
      return

    const trimmedName = formValues.name?.trim() ?? ''
    const body: CopyAppPayload = {
      description: formValues.description?.trim() ?? '',
      icon_type: agentIcon.type,
      icon: agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon,
      icon_background: agentIcon.type === 'emoji' ? agentIcon.background : undefined,
      ...(trimmedName ? { name: trimmedName } : {}),
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
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-130 flex-col overflow-hidden! p-0!">
          <DialogCloseButton className="top-5 right-5 size-8 rounded-lg" />
          <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('roster.duplicateDialog.title')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('roster.duplicateDialog.description', { name: latestAgent.name })}
            </DialogDescription>
          </div>
          <Form<DuplicateAgentFormValues>
            className="min-h-0 flex-1"
            onFormSubmit={handleSubmit}
          >
            <div className="space-y-5 px-6 py-3">
              <div className="flex items-end gap-4 pb-2">
                <button
                  type="button"
                  aria-label={t('roster.duplicateForm.changeIcon', { name: latestAgent.name })}
                  className="shrink-0 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={() => setIconPickerOpen(true)}
                >
                  <AppIcon
                    size="xxl"
                    rounded
                    className="size-16 cursor-pointer"
                    iconType={agentIcon.type === 'link' ? 'image' : agentIcon.type}
                    icon={agentIcon.type === 'emoji' ? agentIcon.icon : undefined}
                    background={agentIcon.type === 'emoji' ? agentIcon.background : undefined}
                    imageUrl={agentIcon.type === 'emoji' ? undefined : agentIcon.url}
                  />
                </button>
                <FieldRoot name="name" className="min-w-0 flex-1">
                  <FieldLabel>
                    {t('roster.createForm.nameLabel')}
                    <span className="ml-1 system-xs-regular text-text-tertiary">
                      {t('roster.createForm.descriptionOptional')}
                    </span>
                  </FieldLabel>
                  <FieldControl
                    autoComplete="off"
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- The duplicate dialog opens from an explicit command, and naming the copy is the primary editable action.
                    autoFocus
                    maxLength={255}
                    onValueChange={setName}
                    placeholder={defaultCopyName}
                    value={name}
                  />
                  <FieldDescription>
                    {t('roster.duplicateForm.nameDescription')}
                  </FieldDescription>
                </FieldRoot>
              </div>
              <FieldRoot name="description">
                <FieldLabel>
                  {t('roster.createForm.descriptionLabel')}
                  <span className="ml-1 system-xs-regular text-text-tertiary">
                    {t('roster.createForm.descriptionOptional')}
                  </span>
                </FieldLabel>
                <Textarea
                  autoComplete="off"
                  className="h-20 resize-none"
                  onValueChange={setDescription}
                  placeholder={t('roster.createForm.descriptionPlaceholder')}
                  value={description}
                />
              </FieldRoot>
            </div>
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
