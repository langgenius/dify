'use client'
import type { AgentAppCopyPayload } from '@dify/contracts/api/console/agent/types.gen'
import type { Ref } from 'react'
import type { AgentFormSource, AgentFormValues, AgentIconSelection } from './agent-form'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
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
  const { t } = useTranslation(['agentRoster'])
  const { t: tCommon } = useTranslation(['common'])
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

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['roster.duplicateDialog.title'], { ns: 'agentRoster' })}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t(($) => $['roster.duplicateDialog.description'], {
            ns: 'agentRoster',
            name: initialValues.sourceName,
          })}
        </DialogDescription>
        <DialogHeaderCloseButton
          aria-label={tCommon(($) => $['operation.close'])}
          disabled={pending}
        />
      </DialogHeader>
      <Form<AgentFormValues>
        className="contents"
        onFormSubmit={(formValues) => onSubmit(formValues, agentIcon)}
      >
        <AgentFormFields
          ref={nameInputRef}
          defaultValues={initialValues.fields}
          icon={agentIcon}
          iconAriaLabel={t(($) => $['roster.duplicateForm.changeIcon'], {
            ns: 'agentRoster',
            name: initialValues.sourceName,
          })}
          onIconChange={setAgentIcon}
        />
        <DialogFooter>
          <Button type="button" className="min-w-18" onClick={onCancel} disabled={pending}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button type="submit" variant="primary" className="min-w-18" loading={pending}>
            {tCommon(($) => $['operation.duplicate'])}
          </Button>
        </DialogFooter>
      </Form>
    </>
  )
}

export function DuplicateAgentDialog({ agent, open, onOpenChange }: DuplicateAgentDialogProps) {
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
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
        <DialogContent initialFocus={nameInputRef} className="w-130">
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
