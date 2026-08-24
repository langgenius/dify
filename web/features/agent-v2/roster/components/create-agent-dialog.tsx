'use client'
import type { AgentAppCreatePayload } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFormValues, AgentIconSelection } from './agent-form'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { getAgentDetailPath } from '../../agent-detail/routes'
import { defaultAgentIcon } from './agent-form'
import { AgentFormFields } from './agent-form-fields'

type CreateAgentDialogProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateAgentDialog({ open, onOpenChange }: CreateAgentDialogProps = {}) {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [role, setRole] = useState('')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [agentIcon, setAgentIcon] = useState<AgentIconSelection>(defaultAgentIcon)
  const createAgentMutation = useMutation(consoleQuery.agent.post.mutationOptions())

  const resetForm = () => {
    setFormKey((key) => key + 1)
    setName('')
    setDescription('')
    setRole('')
    setAgentIcon(defaultAgentIcon)
    setIconPickerOpen(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (open === undefined) setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
    if (!nextOpen) resetForm()
  }

  const handleSubmit = (formValues: AgentFormValues) => {
    const trimmedName = formValues.name?.trim() ?? ''
    const trimmedRole = formValues.role?.trim() ?? ''
    if (createAgentMutation.isPending) return

    const body = {
      name: trimmedName,
      description: formValues.description?.trim() ?? '',
      role: trimmedRole,
      icon_type: agentIcon.type,
      icon: agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon,
      icon_background: agentIcon.type === 'emoji' ? agentIcon.background : undefined,
    } satisfies AgentAppCreatePayload

    createAgentMutation.mutate(
      {
        body,
      },
      {
        onSuccess: (createdAgent) => {
          trackCreateApp({
            source: 'studio_blank',
            appMode: 'agent-v2',
          })
          toast.success(t(($) => $['roster.createSuccess']))
          handleOpenChange(false)
          router.push(getAgentDetailPath(createdAgent.id, 'configure'))
        },
      },
    )
  }

  return (
    <>
      <Dialog
        open={open ?? uncontrolledOpen}
        onOpenChange={handleOpenChange}
        disablePointerDismissal
      >
        {open === undefined && (
          <DialogTrigger render={<Button variant="primary" className="h-8" />}>
            <span aria-hidden className="i-ri-add-line size-4" />
            <span className="system-sm-medium">{t(($) => $['roster.createAgent'])}</span>
          </DialogTrigger>
        )}
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-130 flex-col overflow-hidden! p-0!">
          <DialogClose
            render={
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                size="lg"
                className="absolute inset-e-6 top-6"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
          <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['roster.createDialog.title'])}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t(($) => $['roster.createDialog.description'])}
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
              iconAriaLabel={t(($) => $['roster.createForm.changeIcon'])}
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
                disabled={createAgentMutation.isPending}
              >
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="min-w-18"
                loading={createAgentMutation.isPending}
              >
                {tCommon(($) => $['operation.create'])}
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
