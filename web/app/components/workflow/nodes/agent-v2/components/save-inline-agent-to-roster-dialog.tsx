'use client'
import type {
  AgentComposerAgentResponse,
  WorkflowAgentComposerResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { Ref } from 'react'
import type {
  AgentFormValues,
  AgentIconSelection,
} from '@/features/agent-v2/roster/components/agent-form'
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
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { createAgentIconSelection } from '@/features/agent-v2/roster/components/agent-form'
import { AgentFormFields } from '@/features/agent-v2/roster/components/agent-form-fields'
import { consoleQuery } from '@/service/client'
import { FlowType } from '@/types/common'

type SaveInlineAgentToRosterDialogProps = {
  flowId: string
  flowType: FlowType.appFlow | FlowType.snippet
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
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [initialValues] = useState(() => ({
    fields: {
      description: initialAgent.description ?? '',
      name: '',
      role: initialAgent.role ?? '',
    } satisfies AgentFormValues,
    icon: createAgentIconSelection(initialAgent),
  }))
  const [agentIcon, setAgentIcon] = useState(initialValues.icon)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  return (
    <>
      <div className="shrink-0 ps-6 pe-14 pt-6 pb-3">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['roster.saveToRosterDialog.title'])}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t(($) => $['roster.saveToRosterDialog.description'])}
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
          iconAriaLabel={t(($) => $['roster.saveToRosterForm.changeIcon'])}
          onIconClick={() => setIconPickerOpen(true)}
        />
        <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
          <Button type="button" className="min-w-18" onClick={onCancel} disabled={pending}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button type="submit" variant="primary" className="min-w-18" loading={pending}>
            {tCommon(($) => $['operation.save'])}
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

export function SaveInlineAgentToRosterDialog({
  flowId,
  flowType,
  initialAgent,
  nodeId,
  open,
  onOpenChange,
  onSaved,
}: SaveInlineAgentToRosterDialogProps) {
  const { t } = useTranslation('agentV2')
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

    if (flowType === FlowType.snippet) {
      snippetSaveToRosterMutation.mutate(
        {
          params: {
            snippet_id: flowId,
            node_id: nodeId,
          },
          body,
        },
        options,
      )
      return
    }

    if (flowType === FlowType.appFlow) {
      appSaveToRosterMutation.mutate(
        {
          params: {
            app_id: flowId,
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
        <DialogContent
          initialFocus={nameInputRef}
          className="flex max-h-[calc(100dvh-2rem)] w-130 flex-col overflow-hidden! p-0!"
        >
          <DialogClose
            disabled={isSavingToRoster}
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
