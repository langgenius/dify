'use client'

import type {
  AgentAppCopyPayload,
  AgentAppPartial,
} from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFormValues, AgentIconSelection } from './agent-form'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldControl, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { consoleQuery } from '@/service/client'
import { createAgentIconSelection } from './agent-form'

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
  const latestAgent =
    queryClient.getQueryData<AgentAppPartial>(
      consoleQuery.agent.byAgentId.get.queryKey({
        input: {
          params: {
            agent_id: agent.id,
          },
        },
      }),
    ) ?? agent
  const [renderedFormKey, setRenderedFormKey] = useState(formKey)
  const [name, setName] = useState('')
  const [description, setDescription] = useState(latestAgent.description ?? '')
  const [role, setRole] = useState(latestAgent.role ?? '')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [agentIcon, setAgentIcon] = useState<AgentIconSelection>(() =>
    createAgentIconSelection(latestAgent),
  )
  const duplicateAgentMutation = useMutation(
    consoleQuery.agent.byAgentId.copy.post.mutationOptions(),
  )
  const defaultCopyName = getDefaultCopyName(latestAgent.name)

  if (formKey !== renderedFormKey) {
    setRenderedFormKey(formKey)
    setName('')
    setDescription(latestAgent.description ?? '')
    setRole(latestAgent.role ?? '')
    setIconPickerOpen(false)
    setAgentIcon(createAgentIconSelection(latestAgent))
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const currentAgent =
        queryClient.getQueryData<AgentAppPartial>(
          consoleQuery.agent.byAgentId.get.queryKey({
            input: {
              params: {
                agent_id: agent.id,
              },
            },
          }),
        ) ?? agent
      setName('')
      setDescription(currentAgent.description ?? '')
      setRole(currentAgent.role ?? '')
      setAgentIcon(createAgentIconSelection(currentAgent))
    } else {
      setIconPickerOpen(false)
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = (formValues: AgentFormValues) => {
    if (duplicateAgentMutation.isPending) return

    const trimmedName = formValues.name?.trim() ?? ''
    const trimmedRole = formValues.role?.trim() ?? ''
    const body: AgentAppCopyPayload = {
      description: formValues.description?.trim() ?? '',
      role: trimmedRole,
      icon_type: agentIcon.type,
      icon: agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon,
      icon_background: agentIcon.type === 'emoji' ? agentIcon.background : undefined,
      ...(trimmedName ? { name: trimmedName } : {}),
    }

    duplicateAgentMutation.mutate(
      {
        params: {
          agent_id: agent.id,
        },
        body,
      },
      {
        onSuccess: () => {
          toast.success(t(($) => $['roster.duplicateSuccess']))
          handleOpenChange(false)
        },
      },
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-130 flex-col overflow-hidden! p-0!">
          <DialogCloseButton />
          <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['roster.duplicateDialog.title'])}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t(($) => $['roster.duplicateDialog.description'], { name: latestAgent.name })}
            </DialogDescription>
          </div>
          <Form<AgentFormValues>
            key={formKey}
            className="min-h-0 flex-1"
            onFormSubmit={handleSubmit}
          >
            <div className="space-y-5 px-6 py-3">
              <div className="flex items-end gap-4 pb-2">
                <button
                  type="button"
                  aria-label={t(($) => $['roster.duplicateForm.changeIcon'], {
                    name: latestAgent.name,
                  })}
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
                  <Field name="name" className="relative min-w-0 flex-1">
                    <FieldLabel>
                      {t(($) => $['roster.createForm.nameLabel'])}
                      <span className="ml-1 system-xs-regular text-text-tertiary">
                        {tCommon(($) => $['label.optional'])}
                      </span>
                    </FieldLabel>
                    <FieldControl
                      autoComplete="off"
                      // oxlint-disable-next-line jsx-a11y/no-autofocus -- The duplicate dialog opens from an explicit command, and naming the copy is the primary editable action.
                      autoFocus
                      maxLength={255}
                      onValueChange={setName}
                      placeholder={defaultCopyName}
                      value={name}
                    />
                  </Field>
                  <Field name="role" className="relative min-w-0 flex-1">
                    <FieldLabel>
                      {t(($) => $['roster.createForm.roleLabel'])}
                      <span className="ml-1 system-xs-regular text-text-tertiary">
                        {tCommon(($) => $['label.optional'])}
                      </span>
                    </FieldLabel>
                    <FieldControl
                      autoComplete="off"
                      maxLength={255}
                      onValueChange={setRole}
                      placeholder={t(($) => $['roster.createForm.rolePlaceholder'])}
                      value={role}
                    />
                  </Field>
                </div>
              </div>
              <Field name="description">
                <FieldLabel>
                  {t(($) => $['roster.createForm.descriptionLabel'])}
                  <span className="ml-1 system-xs-regular text-text-tertiary">
                    {tCommon(($) => $['label.optional'])}
                  </span>
                </FieldLabel>
                <Textarea
                  autoComplete="off"
                  className="h-20 resize-none"
                  onValueChange={setDescription}
                  placeholder={t(($) => $['roster.createForm.descriptionPlaceholder'])}
                  value={description}
                />
              </Field>
            </div>
            <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
              <Button
                type="button"
                className="min-w-18"
                onClick={() => handleOpenChange(false)}
                disabled={duplicateAgentMutation.isPending}
              >
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="min-w-18"
                loading={duplicateAgentMutation.isPending}
              >
                {tCommon(($) => $['operation.duplicate'])}
              </Button>
            </div>
          </Form>
        </DialogContent>
      </Dialog>
      <AppIconPicker
        open={iconPickerOpen}
        initialEmoji={
          agentIcon.type === 'emoji'
            ? { icon: agentIcon.icon, background: agentIcon.background }
            : undefined
        }
        onOpenChange={setIconPickerOpen}
        onSelect={setAgentIcon}
      />
    </>
  )
}
