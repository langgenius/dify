'use client'
import type { AgentAppCopyPayload } from '@dify/contracts/api/console/agent/types.gen'
import type { Ref } from 'react'
import type { AgentFormSource, AgentFormValues } from './agent-form'
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
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { createAgentIconSelection } from './agent-form'
import { AgentFormFields } from './agent-form-fields'

type DuplicateAgentDialogContentProps = {
  agent: AgentFormSource
  pending: boolean
  onSubmit: (body: AgentAppCopyPayload) => void
}

type DuplicateAgentFormSessionProps = DuplicateAgentDialogContentProps & {
  nameInputRef: Ref<HTMLInputElement>
}

const getDefaultCopyName = (name: string) => {
  const suffix = ' copy'
  return `${name.slice(0, 255 - suffix.length)}${suffix}`
}

function DuplicateAgentFormSession({
  agent: listedAgent,
  nameInputRef,
  pending,
  onSubmit,
}: DuplicateAgentFormSessionProps) {
  const { t } = useTranslation(['agentRoster'])
  const { t: tCommon } = useTranslation(['common'])
  const queryClient = useQueryClient()
  const [initialValues] = useState(() => {
    const agent =
      queryClient.getQueryData<AgentFormSource>(
        consoleQuery.agent.byAgentId.get.queryKey({
          input: { params: { agent_id: listedAgent.id } },
        }),
      ) ?? listedAgent
    return {
      fields: {
        description: agent.description ?? '',
        name: getDefaultCopyName(agent.name),
        role: agent.role ?? '',
      } satisfies AgentFormValues,
      icon: createAgentIconSelection(agent),
      sourceName: agent.name,
    }
  })
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
        onFormSubmit={(formValues) =>
          onSubmit({
            name: formValues.name.trim(),
            description: formValues.description.trim(),
            role: formValues.role.trim(),
            icon_type: agentIcon.type,
            icon: agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon,
            icon_background: agentIcon.type === 'emoji' ? agentIcon.background : undefined,
          })
        }
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
          <DialogClose disabled={pending} render={<Button type="button" className="min-w-18" />}>
            {tCommon(($) => $['operation.cancel'])}
          </DialogClose>
          <Button type="submit" variant="primary" className="min-w-18" loading={pending}>
            {tCommon(($) => $['operation.duplicate'])}
          </Button>
        </DialogFooter>
      </Form>
    </>
  )
}

export function DuplicateAgentDialogContent({
  agent,
  pending,
  onSubmit,
}: DuplicateAgentDialogContentProps) {
  const nameInputRef = useRef<HTMLInputElement>(null)

  return (
    <DialogContent initialFocus={nameInputRef} className="w-130">
      <DuplicateAgentFormSession
        agent={agent}
        nameInputRef={nameInputRef}
        pending={pending}
        onSubmit={onSubmit}
      />
    </DialogContent>
  )
}
