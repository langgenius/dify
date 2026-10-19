'use client'

import type {
  AgentComposerAgentResponse,
  WorkflowAgentComposerResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Ref } from 'react'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type {
  AgentFormValues,
  AgentIconSelection,
} from '@/features/agent-v2/roster/components/agent-form'
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
import { createAgentIconSelection } from '@/features/agent-v2/roster/components/agent-form'
import { AgentFormFields } from '@/features/agent-v2/roster/components/agent-form-fields'
import { consoleQuery } from '@/service/console'

type SaveInlineAgentToRosterDialogProps = {
  resource: Extract<EditorResource, { kind: 'app' | 'snippet' }>
  initialAgent: AgentComposerAgentResponse
  nodeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (agentId: string) => void
}

type SaveInlineAgentToRosterFormSessionProps = {
  initialAgent: AgentComposerAgentResponse
  nameInputRef: Ref<HTMLInputElement>
  pending: boolean
  onCancel: () => void
  onSubmit: (formValues: AgentFormValues, agentIcon: AgentIconSelection) => void
}

function SaveInlineAgentToRosterFormSession({
  initialAgent,
  nameInputRef,
  pending,
  onCancel,
  onSubmit,
}: SaveInlineAgentToRosterFormSessionProps) {
  const { t } = useTranslation(['agentRoster'])
  const { t: tCommon } = useTranslation(['common'])
  const [initialValues] = useState(() => ({
    fields: {
      description: initialAgent.description ?? '',
      name: '',
      role: initialAgent.role ?? '',
    } satisfies AgentFormValues,
    icon: createAgentIconSelection(initialAgent),
  }))
  const [agentIcon, setAgentIcon] = useState(initialValues.icon)

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['roster.saveToRosterDialog.title'], { ns: 'agentRoster' })}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t(($) => $['roster.saveToRosterDialog.description'], { ns: 'agentRoster' })}
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
          iconAriaLabel={t(($) => $['roster.saveToRosterForm.changeIcon'], { ns: 'agentRoster' })}
          onIconChange={setAgentIcon}
        />
        <DialogFooter>
          <Button type="button" className="min-w-18" onClick={onCancel} disabled={pending}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button type="submit" variant="primary" className="min-w-18" loading={pending}>
            {tCommon(($) => $['operation.save'])}
          </Button>
        </DialogFooter>
      </Form>
    </>
  )
}

export function SaveInlineAgentToRosterDialog({
  resource,
  initialAgent,
  nodeId,
  open,
  onOpenChange,
  onSaved,
}: SaveInlineAgentToRosterDialogProps) {
  const nameInputRef = useRef<HTMLInputElement>(null)
  const appSaveToRosterMutation = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.saveToRoster.post.mutationOptions(),
  )
  const snippetSaveToRosterMutation = useMutation(
    consoleQuery.snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.saveToRoster.post.mutationOptions(),
  )
  const isSavingToRoster =
    appSaveToRosterMutation.isPending || snippetSaveToRosterMutation.isPending
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSavingToRoster) return
    onOpenChange(nextOpen)
  }

  const handleSubmit = (formValues: AgentFormValues, agentIcon: AgentIconSelection) => {
    if (isSavingToRoster) return

    const body = {
      variant: 'workflow' as const,
      save_strategy: 'save_to_roster' as const,
      new_agent_name: formValues.name.trim(),
      description: formValues.description.trim(),
      role: formValues.role.trim(),
      icon_type: agentIcon.type,
      icon: agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon,
      icon_background: agentIcon.type === 'emoji' ? agentIcon.background : undefined,
    }
    const options = {
      onSuccess: (composerState: WorkflowAgentComposerResponse) => {
        const binding = composerState.binding
        if (binding?.binding_type !== 'roster_agent' || !binding.agent_id) return

        onSaved(binding.agent_id)
        onOpenChange(false)
      },
    }

    if (resource.kind === 'snippet') {
      snippetSaveToRosterMutation.mutate(
        {
          params: {
            snippet_id: resource.snippetId,
            node_id: nodeId,
          },
          body,
        },
        options,
      )
      return
    }

    if (resource.kind === 'app') {
      appSaveToRosterMutation.mutate(
        {
          params: {
            app_id: resource.appId,
            node_id: nodeId,
          },
          body,
        },
        options,
      )
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
        <DialogContent initialFocus={nameInputRef} className="w-130">
          <SaveInlineAgentToRosterFormSession
            initialAgent={initialAgent}
            nameInputRef={nameInputRef}
            pending={isSavingToRoster}
            onCancel={() => onOpenChange(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
