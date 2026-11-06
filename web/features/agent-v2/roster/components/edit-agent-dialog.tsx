'use client'
import type { AgentAppUpdatePayload } from '@dify/contracts/api/console/agent/types.gen'
import type { ChangeEventHandler, Ref } from 'react'
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
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { createAgentIconSelection, getAgentIconKey } from './agent-form'
import { AgentFormFields } from './agent-form-fields'

type EditAgentDialogProps = {
  agent: AgentFormSource
  open: boolean
  onOpenChange: (open: boolean) => void
}

type EditAgentFormSessionProps = {
  agent: AgentFormSource
  nameInputRef: Ref<HTMLInputElement>
  pending: boolean
  onCancel: () => void
  onSubmit: (formValues: AgentFormValues, agentIcon: AgentIconSelection) => void
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

function EditAgentFormSession({
  agent,
  nameInputRef,
  pending,
  onCancel,
  onSubmit,
}: EditAgentFormSessionProps) {
  const { t } = useTranslation(['agentRoster'])
  const { t: tCommon } = useTranslation(['common'])
  const [initialValues] = useState(() => ({
    fields: {
      description: agent.description ?? '',
      name: agent.name,
      role: agent.role ?? '',
    } satisfies AgentFormValues,
    icon: createAgentIconSelection(agent),
  }))
  const [agentIcon, setAgentIcon] = useState(initialValues.icon)
  const [hasTextChanges, setHasTextChanges] = useState(false)
  const hasIconChanges = getAgentIconKey(agentIcon) !== getAgentIconKey(initialValues.icon)
  const hasChanges = hasTextChanges || hasIconChanges

  const handleFormChange: ChangeEventHandler<HTMLFormElement> = (event) => {
    const formValues = new FormData(event.currentTarget)
    setHasTextChanges(
      String(formValues.get('name') ?? '').trim() !== initialValues.fields.name.trim() ||
        String(formValues.get('description') ?? '').trim() !==
          initialValues.fields.description.trim() ||
        String(formValues.get('role') ?? '').trim() !== initialValues.fields.role.trim(),
    )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $['roster.editDialog.title'], { ns: 'agentRoster' })}</DialogTitle>
        <DialogDescription className="sr-only">
          {t(($) => $['roster.editDialog.description'], { ns: 'agentRoster' })}
        </DialogDescription>
        <DialogHeaderCloseButton
          aria-label={tCommon(($) => $['operation.close'])}
          disabled={pending}
        />
      </DialogHeader>
      <Form<AgentFormValues>
        className="contents"
        onChange={handleFormChange}
        onFormSubmit={(formValues) => {
          if (hasChanges) onSubmit(formValues, agentIcon)
        }}
      >
        <AgentFormFields
          ref={nameInputRef}
          defaultValues={initialValues.fields}
          icon={agentIcon}
          iconAriaLabel={t(($) => $['roster.createForm.changeIcon'], { ns: 'agentRoster' })}
          onIconChange={setAgentIcon}
        />
        <DialogFooter>
          <Button type="button" className="min-w-18" onClick={onCancel} disabled={pending}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button
            type="submit"
            variant="primary"
            className="min-w-18"
            disabled={!hasChanges}
            loading={pending}
          >
            {tCommon(($) => $['operation.save'])}
          </Button>
        </DialogFooter>
      </Form>
    </>
  )
}

export function EditAgentDialog({ agent, open, onOpenChange }: EditAgentDialogProps) {
  const nameInputRef = useRef<HTMLInputElement>(null)
  const updateAgentMutation = useMutation(consoleQuery.agent.byAgentId.put.mutationOptions())

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && updateAgentMutation.isPending) return
    onOpenChange(nextOpen)
  }

  const handleSubmit = (formValues: AgentFormValues, agentIcon: AgentIconSelection) => {
    if (updateAgentMutation.isPending) return

    const body: AgentAppUpdatePayload = {
      name: formValues.name.trim(),
      description: formValues.description.trim(),
      // Keep sending the trimmed role even when empty: omitting the field
      // preserves the current backing-agent role, while "" intentionally clears it.
      role: formValues.role.trim(),
    }

    applyIconPayload(body, agentIcon)

    updateAgentMutation.mutate(
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
          <EditAgentFormSession
            key={agent.id}
            agent={agent}
            nameInputRef={nameInputRef}
            pending={updateAgentMutation.isPending}
            onCancel={() => onOpenChange(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
