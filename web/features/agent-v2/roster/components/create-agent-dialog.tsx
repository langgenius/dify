'use client'

import type { AgentAppCreatePayload } from '@dify/contracts/api/console/agent/types.gen'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogCloseButton, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@langgenius/dify-ui/dialog'
import { FieldControl, FieldError, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import { consoleQuery } from '@/service/client'

type AgentFormValues = {
  description?: string
  name?: string
  role?: string
}

const defaultAgentIcon = {
  type: 'emoji',
  icon: '🧸',
  background: '#F5F3FF',
} satisfies AppIconSelection

export function CreateAgentDialog() {
  const { t } = useTranslation('agentV2')
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [agentIcon, setAgentIcon] = useState<AppIconSelection>(defaultAgentIcon)
  const createAgentMutation = useMutation(consoleQuery.agent.post.mutationOptions())

  const resetForm = () => {
    setFormKey(key => key + 1)
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
      onError: () => {
        toast.error(t('roster.createFailed'))
      },
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
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
          <DialogCloseButton className="top-5 right-5 size-8 rounded-lg" />
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
            <div className="space-y-5 px-6 py-3">
              <div className="flex items-end gap-4 pb-2">
                <button
                  type="button"
                  aria-label={t('roster.createForm.changeIcon')}
                  className="shrink-0 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  onClick={() => setIconPickerOpen(true)}
                >
                  <AppIcon
                    size="xxl"
                    rounded
                    className="size-16 cursor-pointer"
                    iconType={agentIcon.type}
                    icon={agentIcon.type === 'image' ? agentIcon.fileId : agentIcon.icon}
                    background={agentIcon.type === 'emoji' ? agentIcon.background : undefined}
                    imageUrl={agentIcon.type === 'image' ? agentIcon.url : undefined}
                  />
                </button>
                <div className="flex min-w-0 flex-1 gap-3 pb-1">
                  <FieldRoot
                    name="name"
                    className="relative min-w-0 flex-1"
                    validate={(value) => {
                      if (typeof value === 'string' && value.length > 0 && !value.trim())
                        return t('roster.createForm.nameRequired')

                      return null
                    }}
                  >
                    <FieldLabel>
                      {t('roster.createForm.nameLabel')}
                    </FieldLabel>
                    <FieldControl
                      autoComplete="off"
                      // eslint-disable-next-line jsx-a11y/no-autofocus -- The create dialog opens from an explicit command, and the next expected action is naming the agent.
                      autoFocus
                      maxLength={255}
                      placeholder={t('roster.createForm.namePlaceholder')}
                      required
                    />
                    <div className="absolute top-full left-0 mt-1">
                      <FieldError match="valueMissing">{t('roster.createForm.nameRequired')}</FieldError>
                      <FieldError match="customError" />
                    </div>
                  </FieldRoot>
                  <FieldRoot
                    name="role"
                    className="relative min-w-0 flex-1"
                    validate={(value) => {
                      if (typeof value === 'string' && value.length > 0 && !value.trim())
                        return t('roster.createForm.roleRequired')

                      return null
                    }}
                  >
                    <FieldLabel>
                      {t('roster.createForm.roleLabel')}
                    </FieldLabel>
                    <FieldControl
                      autoComplete="off"
                      maxLength={255}
                      placeholder={t('roster.createForm.rolePlaceholder')}
                      required
                    />
                    <div className="absolute top-full left-0 mt-1">
                      <FieldError match="valueMissing">{t('roster.createForm.roleRequired')}</FieldError>
                      <FieldError match="customError" />
                    </div>
                  </FieldRoot>
                </div>
              </div>
              <FieldRoot name="description">
                <FieldLabel>
                  {t('roster.createForm.descriptionLabel')}
                  <span className="ml-1 system-xs-regular text-text-tertiary">
                    {t('roster.createForm.descriptionOptional')}
                  </span>
                </FieldLabel>
                <Textarea
                  autoComplete="off"
                  className="h-20 resize-none"
                  placeholder={t('roster.createForm.descriptionPlaceholder')}
                />
              </FieldRoot>
            </div>
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
