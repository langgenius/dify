'use client'

import type { AgentAppCreatePayload } from '@dify/contracts/api/console/agent/types.gen'
import type { AgentFormValues, AgentIconSelection } from './agent-form'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { consoleQuery } from '@/service/client'
import { defaultAgentIcon } from './agent-form'
import { AgentFormFields } from './agent-form-fields'

export function CreateAgentDialog() {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [role, setRole] = useState('')
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [agentIcon, setAgentIcon] = useState<AgentIconSelection>(defaultAgentIcon)
  const createAgentMutation = useMutation(consoleQuery.agent.post.mutationOptions())

  const resetForm = () => {
    setFormKey(key => key + 1)
    setName('')
    setDescription('')
    setRole('')
    setAgentIcon(defaultAgentIcon)
    setIconPickerOpen(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen)
      resetForm()
  }

  const handleSubmit = (formValues: AgentFormValues) => {
    const trimmedName = formValues.name?.trim() ?? ''
    const trimmedRole = formValues.role?.trim() ?? ''
    if (createAgentMutation.isPending)
      return

    const body = {
      name: trimmedName,
      description: formValues.description?.trim() ?? '',
      role: trimmedRole,
      icon_type: agentIcon.type,
      icon: agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon,
      icon_background: agentIcon.type === 'emoji' ? agentIcon.background : undefined,
    } satisfies AgentAppCreatePayload

    createAgentMutation.mutate({
      body,
    }, {
      onSuccess: () => {
        toast.success(t('roster.createSuccess'))
        handleOpenChange(false)
      },
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
        <DialogTrigger
          render={(
            <Button
              variant="primary"
              className="h-8 gap-0.5 px-3"
            />
          )}
        >
          <span aria-hidden className="i-ri-add-line size-4" />
          <span className="px-0.5 system-sm-medium">{t('roster.createAgent')}</span>
        </DialogTrigger>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[520px] flex-col overflow-hidden! p-0!">
          <DialogCloseButton />
          <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
            <DialogTitle className="title-2xl-semi-bold text-text-primary">
              {t('roster.createDialog.title')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t('roster.createDialog.description')}
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
              iconAriaLabel={t('roster.createForm.changeIcon')}
              name={name}
              role={role}
              onDescriptionChange={setDescription}
              onIconClick={() => setIconPickerOpen(true)}
              onNameChange={setName}
              onRoleChange={setRole}
            />
            <div className="flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
              <Button type="button" className="min-w-18" onClick={() => handleOpenChange(false)} disabled={createAgentMutation.isPending}>
                {tCommon('operation.cancel')}
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="min-w-18"
                loading={createAgentMutation.isPending}
              >
                {tCommon('operation.create')}
              </Button>
            </div>
          </Form>
        </DialogContent>
      </Dialog>
      <AppIconPicker
        open={iconPickerOpen}
        initialEmoji={agentIcon.type === 'emoji'
          ? { icon: agentIcon.icon, background: agentIcon.background }
          : undefined}
        onOpenChange={setIconPickerOpen}
        onSelect={setAgentIcon}
      />
    </>
  )
}
