'use client'

import type { AgentAppPartial, AgentAppUpdatePayload } from '@dify/contracts/api/console/agent/types.gen'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { consoleQuery } from '@/service/client'

type EditAgentDialogProps = {
  agent: AgentAppPartial
  open: boolean
  onOpenChange: (open: boolean) => void
}

type AgentFormValues = {
  description?: string
  name?: string
  role?: string
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

const getAgentIconKey = (icon: AgentIconSelection) => {
  if (icon.type === 'emoji')
    return `${icon.type}:${icon.icon}:${icon.background}`

  if (icon.type === 'image')
    return `${icon.type}:${icon.fileId}`

  return `${icon.type}:${icon.icon}`
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
  open,
  onOpenChange,
}: EditAgentDialogProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [name, setName] = useState(agent.name)
  const [description, setDescription] = useState(agent.description ?? '')
  const [role, setRole] = useState(agent.role ?? '')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [agentIcon, setAgentIcon] = useState<AgentIconSelection>(() => createAgentIconSelection(agent))
  const updateAgentMutation = useMutation(consoleQuery.agent.byAgentId.put.mutationOptions())

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
      setAgentIcon(createAgentIconSelection(agent))
    }
    else {
      setIconPickerOpen(false)
    }
    onOpenChange(nextOpen)
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
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[520px] flex-col overflow-hidden! p-0!">
          <DialogCloseButton className="top-5 right-5 size-8 rounded-lg" />
          <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('roster.editDialog.title')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('roster.editDialog.description')}
            </DialogDescription>
          </div>
          <Form<AgentFormValues>
            className="min-h-0 flex-1"
            onFormSubmit={handleSubmit}
          >
            <div className="space-y-5 px-6 py-3">
              <div className="flex items-end gap-4 pb-2">
                <button
                  type="button"
                  aria-label={t('roster.editAgent', { name: agent.name })}
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
                <div className="flex min-w-0 flex-1 gap-3 pb-1">
                  <FieldRoot
                    name="name"
                    className="relative min-w-0 flex-1"
                    validate={(value) => {
                      if (typeof value === 'string' && value.length > 0 && !value.trim())
                        return t('roster.createForm.nameRequired')

                      return null
                    }}
                  >
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
                    <div className="absolute top-full left-0 mt-1">
                      <FieldError match="valueMissing">{t('roster.createForm.nameRequired')}</FieldError>
                      <FieldError match="customError" />
                    </div>
                  </FieldRoot>
                  <FieldRoot
                    name="role"
                    className="relative min-w-0 flex-1"
                    validate={(value) => {
                      if (typeof value === 'string' && value.length > 0 && !value.trim())
                        return t('roster.createForm.roleRequired')

                      return null
                    }}
                  >
                    <FieldLabel>
                      {t('roster.createForm.roleLabel')}
                    </FieldLabel>
                    <FieldControl
                      autoComplete="off"
                      maxLength={255}
                      onValueChange={setRole}
                      placeholder={t('roster.createForm.rolePlaceholder')}
                      required
                      value={role}
                    />
                    <div className="absolute top-full left-0 mt-1">
                      <FieldError match="valueMissing">{t('roster.createForm.roleRequired')}</FieldError>
                      <FieldError match="customError" />
                    </div>
                  </FieldRoot>
                </div>
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
              <Button type="button" className="min-w-18" onClick={() => onOpenChange(false)} disabled={updateAgentMutation.isPending}>
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
