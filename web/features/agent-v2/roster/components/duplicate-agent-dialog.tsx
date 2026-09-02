'use client'
import type { AgentAppCopyPayload } from '@dify/contracts/api/console/agent/types.gen'
import type { Ref } from 'react'
import type { AgentFormSource, AgentFormValues, AgentIconSelection } from './agent-form'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { consoleQuery } from '@/service/client'
import { createAgentIconSelection } from './agent-form'
import { AgentFormFields } from './agent-form-fields'

type DuplicateAgentDialogProps = {
  agent: AgentFormSource
  open: boolean
  onOpenChange: (open: boolean) => void
}

type DuplicateAgentFormSessionProps = {
  agent: AgentFormSource
  nameInputRef: Ref<HTMLInputElement>
  pending: boolean
  onCancel: () => void
  onSubmit: (formValues: AgentFormValues, agentIcon: AgentIconSelection) => void
}

const getDefaultCopyName = (name: string) => {
  const suffix = ' copy'
  return `${name.slice(0, 255 - suffix.length)}${suffix}`
}

function DuplicateAgentFormSession({
  agent,
  nameInputRef,
  pending,
  onCancel,
  onSubmit,
}: DuplicateAgentFormSessionProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [initialValues] = useState(() => ({
    fields: {
      description: agent.description ?? '',
      name: getDefaultCopyName(agent.name),
      role: agent.role ?? '',
    } satisfies AgentFormValues,
    icon: createAgentIconSelection(agent),
    sourceName: agent.name,
  }))
  const [agentIcon, setAgentIcon] = useState(initialValues.icon)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  return (
    <>
      <div className="shrink-0 ps-6 pe-14 pt-6 pb-3">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['roster.duplicateDialog.title'])}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t(($) => $['roster.duplicateDialog.description'], {
            name: initialValues.sourceName,
          })}
        </DialogDescription>
      </div>
      <Form<AgentFormValues>
        className="flex min-h-0 flex-1 flex-col"
        onFormSubmit={(formValues) => onSubmit(formValues, agentIcon)}
      >
        <AgentFormFields
          ref={nameInputRef}
          defaultValues={initialValues.fields}
          icon={agentIcon}
          iconAriaLabel={t(($) => $['roster.duplicateForm.changeIcon'], {
            name: initialValues.sourceName,
          })}
          onIconClick={() => setIconPickerOpen(true)}
        />
        <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
          <Button type="button" className="min-w-18" onClick={onCancel} disabled={pending}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button type="submit" variant="primary" className="min-w-18" loading={pending}>
            {tCommon(($) => $['operation.duplicate'])}
          </Button>
        </div>
      </Form>
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

export function DuplicateAgentDialog({ agent, open, onOpenChange }: DuplicateAgentDialogProps) {
  const { t } = useTranslation('agentV2')
  const queryClient = useQueryClient()
  const latestAgent =
    queryClient.getQueryData<AgentFormSource>(
      consoleQuery.agent.byAgentId.get.queryKey({
        input: {
          params: {
            agent_id: agent.id,
          },
        },
      }),
    ) ?? agent
  const nameInputRef = useRef<HTMLInputElement>(null)
  const duplicateAgentMutation = useMutation(
    consoleQuery.agent.byAgentId.copy.post.mutationOptions(),
  )
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && duplicateAgentMutation.isPending) return
    onOpenChange(nextOpen)
  }

  const handleSubmit = (formValues: AgentFormValues, agentIcon: AgentIconSelection) => {
    if (duplicateAgentMutation.isPending) return

    const body: AgentAppCopyPayload = {
      name: formValues.name.trim(),
      description: formValues.description.trim(),
      role: formValues.role.trim(),
      icon_type: agentIcon.type,
      icon: agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon,
      icon_background: agentIcon.type === 'emoji' ? agentIcon.background : undefined,
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
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
        <DialogContent
          initialFocus={nameInputRef}
          className="flex max-h-[calc(100dvh-2rem)] w-130 flex-col overflow-hidden! p-0!"
        >
          <DialogClose
            disabled={duplicateAgentMutation.isPending}
            render={
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                size="lg"
                className="absolute inset-e-5 top-5"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
          <DuplicateAgentFormSession
            key={latestAgent.id}
            agent={latestAgent}
            nameInputRef={nameInputRef}
            pending={duplicateAgentMutation.isPending}
            onCancel={() => onOpenChange(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
