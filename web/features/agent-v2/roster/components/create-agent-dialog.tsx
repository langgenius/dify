'use client'
import type { AgentAppCreatePayload } from '@dify/contracts/api/console/agent/types.gen'
import type { Ref } from 'react'
import type { AgentFormValues, AgentIconSelection } from './agent-form'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentScope } from '@/features/agent-v2/analytics'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { getAgentDetailPath } from '../../agent-detail/routes'
import { defaultAgentIcon } from './agent-form'
import { AgentFormFields } from './agent-form-fields'

type CreateAgentDialogProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type CreateAgentFormSessionProps = {
  nameInputRef: Ref<HTMLInputElement>
  pending: boolean
  onCancel: () => void
  onSubmit: (formValues: AgentFormValues, agentIcon: AgentIconSelection) => void
}

const createAgentDefaultValues = {
  description: '',
  name: '',
  role: '',
} satisfies AgentFormValues

function CreateAgentFormSession({
  nameInputRef,
  pending,
  onCancel,
  onSubmit,
}: CreateAgentFormSessionProps) {
  const { t } = useTranslation(['agentRoster'])
  const { t: tCommon } = useTranslation(['common'])
  const [agentIcon, setAgentIcon] = useState<AgentIconSelection>(defaultAgentIcon)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $['roster.createDialog.title'], { ns: 'agentRoster' })}</DialogTitle>
        <DialogDescription className="sr-only">
          {t(($) => $['roster.createDialog.description'], { ns: 'agentRoster' })}
        </DialogDescription>
        <DialogCloseButton aria-label={tCommon(($) => $['operation.close'])} disabled={pending} />
      </DialogHeader>
      <Form<AgentFormValues>
        className="contents"
        onFormSubmit={(formValues) => onSubmit(formValues, agentIcon)}
      >
        <AgentFormFields
          ref={nameInputRef}
          defaultValues={createAgentDefaultValues}
          icon={agentIcon}
          iconAriaLabel={t(($) => $['roster.createForm.changeIcon'], { ns: 'agentRoster' })}
          onIconChange={setAgentIcon}
        />
        <DialogFooter>
          <Button type="button" className="min-w-18" onClick={onCancel} disabled={pending}>
            {tCommon(($) => $['operation.cancel'])}
          </Button>
          <Button type="submit" variant="primary" className="min-w-18" loading={pending}>
            {tCommon(($) => $['operation.create'])}
          </Button>
        </DialogFooter>
      </Form>
    </>
  )
}

export function CreateAgentDialog({ open, onOpenChange }: CreateAgentDialogProps = {}) {
  const { t } = useTranslation(['common', 'agentRoster'])
  const router = useRouter()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const createAgentMutation = useMutation(consoleQuery.agent.post.mutationOptions())

  const setDialogOpen = (nextOpen: boolean) => {
    if (open === undefined) setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && createAgentMutation.isPending) return
    setDialogOpen(nextOpen)
  }

  const handleSubmit = (formValues: AgentFormValues, agentIcon: AgentIconSelection) => {
    if (createAgentMutation.isPending) return

    const body = {
      name: formValues.name.trim(),
      description: formValues.description.trim(),
      role: formValues.role.trim(),
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
            agentScope: AgentScope.Global,
          })
          setDialogOpen(false)
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
            <span className="system-sm-medium">
              {t(($) => $['roster.createAgent'], { ns: 'agentRoster' })}
            </span>
          </DialogTrigger>
        )}
        <DialogContent initialFocus={nameInputRef} className="w-130">
          <CreateAgentFormSession
            nameInputRef={nameInputRef}
            pending={createAgentMutation.isPending}
            onCancel={() => setDialogOpen(false)}
            onSubmit={handleSubmit}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
