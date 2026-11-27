'use client'
import type { AgentAppUpdatePayload } from '@dify/contracts/api/console/agent/types.gen'
import type { ChangeEventHandler, Ref } from 'react'
import type { AgentFormSource, AgentFormValues, AgentIconSelection } from './agent-form'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createAgentIconSelection, getAgentIconKey } from './agent-form'
import { AgentFormFields } from './agent-form-fields'

type EditAgentDialogContentProps = {
  agent: AgentFormSource
  pending: boolean
  onSubmit: (body: AgentAppUpdatePayload) => void
}

type EditAgentFormSessionProps = {
  agent: AgentFormSource
  nameInputRef: Ref<HTMLInputElement>
  pending: boolean
  onSubmit: (body: AgentAppUpdatePayload) => void
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
          if (!hasChanges) return
          const body: AgentAppUpdatePayload = {
            name: formValues.name.trim(),
            description: formValues.description.trim(),
            // Keep sending the trimmed role even when empty: omitting the field
            // preserves the current backing-agent role, while "" intentionally clears it.
            role: formValues.role.trim(),
          }
          applyIconPayload(body, agentIcon)
          onSubmit(body)
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
          <DialogClose disabled={pending} render={<Button type="button" className="min-w-18" />}>
            {tCommon(($) => $['operation.cancel'])}
          </DialogClose>
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

export function EditAgentDialogContent({ agent, pending, onSubmit }: EditAgentDialogContentProps) {
  const nameInputRef = useRef<HTMLInputElement>(null)

  return (
    <DialogContent initialFocus={nameInputRef} className="w-130">
      <EditAgentFormSession
        agent={agent}
        nameInputRef={nameInputRef}
        pending={pending}
        onSubmit={onSubmit}
      />
    </DialogContent>
  )
}
