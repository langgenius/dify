'use client'

import type {
  AgentComposerAgentResponse,
  AgentComposerBindingResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type {
  AgentFormValues,
  AgentIconSelection,
} from '@/features/agent-v2/roster/components/agent-form'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import {
  createAgentIconSelection,
  defaultAgentIcon,
} from '@/features/agent-v2/roster/components/agent-form'
import { AgentFormFields } from '@/features/agent-v2/roster/components/agent-form-fields'
import { consoleQuery } from '@/service/client'

type SaveInlineAgentToRosterDialogProps = {
  appId?: string
  formKey: number
  initialAgent?: AgentComposerAgentResponse | null
  nodeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (binding: AgentComposerBindingResponse) => void
}

export function SaveInlineAgentToRosterDialog({
  appId,
  formKey,
  initialAgent,
  nodeId,
  open,
  onOpenChange,
  onSaved,
}: SaveInlineAgentToRosterDialogProps) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [name, setName] = useState('')
  const [description, setDescription] = useState(initialAgent?.description ?? '')
  const [role, setRole] = useState(initialAgent?.role ?? '')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [agentIcon, setAgentIcon] = useState<AgentIconSelection>(() =>
    initialAgent ? createAgentIconSelection(initialAgent) : defaultAgentIcon,
  )
  const saveToRosterMutation = useMutation(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.saveToRoster.post.mutationOptions(),
  )

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setName('')
      setDescription(initialAgent?.description ?? '')
      setRole(initialAgent?.role ?? '')
      setAgentIcon(initialAgent ? createAgentIconSelection(initialAgent) : defaultAgentIcon)
    } else {
      setIconPickerOpen(false)
    }
    onOpenChange(nextOpen)
  }

  const handleSubmit = (formValues: AgentFormValues) => {
    if (saveToRosterMutation.isPending) return

    if (!appId) return

    const trimmedName = formValues.name?.trim() ?? ''
    const trimmedRole = formValues.role?.trim() ?? ''

    saveToRosterMutation.mutate(
      {
        params: {
          app_id: appId,
          node_id: nodeId,
        },
        body: {
          variant: 'workflow',
          save_strategy: 'save_to_roster',
          new_agent_name: trimmedName,
          description: formValues.description?.trim() ?? '',
          role: trimmedRole,
          icon_type: agentIcon.type,
          icon: agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon,
          icon_background: agentIcon.type === 'emoji' ? agentIcon.background : undefined,
        },
      },
      {
        onSuccess: (composerState) => {
          const binding = composerState.binding
          if (binding?.binding_type !== 'roster_agent' || !binding.agent_id) return

          toast.success(t(($) => $['roster.saveToRosterSuccess']))
          onSaved(binding)
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
              {t(($) => $['roster.saveToRosterDialog.title'])}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t(($) => $['roster.saveToRosterDialog.description'])}
            </DialogDescription>
          </div>
          <Form<AgentFormValues>
            key={formKey}
            className="min-h-0 flex-1"
            onFormSubmit={handleSubmit}
          >
            <AgentFormFields
              description={description}
              icon={agentIcon}
              iconAriaLabel={t(($) => $['roster.saveToRosterForm.changeIcon'])}
              name={name}
              role={role}
              onDescriptionChange={setDescription}
              onIconClick={() => setIconPickerOpen(true)}
              onNameChange={setName}
              onRoleChange={setRole}
            />
            <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
              <Button
                type="button"
                className="min-w-18"
                onClick={() => handleOpenChange(false)}
                disabled={saveToRosterMutation.isPending}
              >
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="min-w-18"
                loading={saveToRosterMutation.isPending}
              >
                {tCommon(($) => $['operation.save'])}
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
        onSelect={(icon) => {
          setAgentIcon(icon)
        }}
      />
    </>
  )
}
