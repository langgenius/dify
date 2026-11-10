'use client'

import type { RefObject } from 'react'
import type { ExternalAgentListItem } from './external-agent-list'
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'

export type ExternalAgentActionRequest = {
  kind: 'edit' | 'toggle' | 'delete'
  agent: ExternalAgentListItem
  trigger: HTMLButtonElement | null
  adjacentFocusTargets: HTMLElement[]
}

type AgentInfo = Pick<ExternalAgentListItem, 'name' | 'role' | 'description'>

type ExternalAgentActionsProps = {
  request: ExternalAgentActionRequest | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  fallbackFocus: RefObject<HTMLElement | null>
  onEdit: (key: string, fields: AgentInfo) => void
  onToggle: (key: string) => void
  onDelete: (key: string) => void
  onRequest: (request: ExternalAgentActionRequest) => void
}

function EditAgentInfo({
  agent,
  onSubmit,
}: {
  agent: ExternalAgentListItem
  onSubmit: (fields: AgentInfo) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  return (
    <Form<AgentInfo>
      className="contents"
      onFormSubmit={(fields) =>
        onSubmit({
          name: fields.name.trim(),
          role: fields.role.trim(),
          description: fields.description.trim(),
        })
      }
    >
      <DialogBody className="space-y-4">
        <div className="flex items-end gap-4">
          <AppIcon
            icon={agent.icon}
            size="xxl"
            shape="circle"
            className="size-16"
            fallback={{
              content: <span className="i-ri-robot-2-line size-8 text-text-tertiary" />,
              background: 'var(--color-background-section-burn)',
            }}
          />
          <Field
            name="name"
            className="min-w-0 flex-1 pb-1"
            validate={(value) =>
              typeof value === 'string' && value.trim()
                ? null
                : t(($) => $['roster.createForm.nameRequired'])
            }
          >
            <FieldLabel>{t(($) => $['roster.createForm.nameLabel'])}</FieldLabel>
            <Input autoComplete="off" defaultValue={agent.name} maxLength={255} required />
            <FieldError match="valueMissing">
              {t(($) => $['roster.createForm.nameRequired'])}
            </FieldError>
            <FieldError match="customError" />
          </Field>
        </div>
        <Field name="role">
          <FieldLabel>
            {t(($) => $['roster.createForm.roleLabel'])}
            <span className="ms-1 system-xs-regular text-text-tertiary">
              {t(($) => $['label.optional'], { ns: 'common' })}
            </span>
          </FieldLabel>
          <Input autoComplete="off" defaultValue={agent.role} maxLength={255} />
        </Field>
        <Field name="description">
          <FieldLabel>{t(($) => $['roster.createForm.descriptionLabel'])}</FieldLabel>
          <Textarea className="h-22" defaultValue={agent.description} maxLength={400} />
          <FieldDescription>{t(($) => $['external.editDialog.descriptionHint'])}</FieldDescription>
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary">
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </Form>
  )
}

export function ExternalAgentActions({
  request,
  open,
  onOpenChange,
  fallbackFocus,
  onEdit,
  onToggle,
  onDelete,
  onRequest,
}: ExternalAgentActionsProps) {
  const { t } = useTranslation(['agentRoster', 'common'])
  if (!request) return null

  const action = request.kind
  const agent = request.agent
  const deleting = action === 'delete'
  const finalFocus = () =>
    (request.trigger?.isConnected
      ? request.trigger
      : request.adjacentFocusTargets.find((target) => target.isConnected)) ??
    fallbackFocus.current ??
    true
  const title = deleting
    ? t(($) => $['external.deleteDialog.title'])
    : agent.enabled
      ? t(($) => $['external.disableDialog.title'])
      : t(($) => $['external.enableDialog.title'])
  const confirmLabel = deleting
    ? t(($) => $['external.delete'])
    : agent.enabled
      ? t(($) => $['external.disable'])
      : t(($) => $['external.enable'])

  return (
    <>
      <Dialog open={open && action === 'edit'} onOpenChange={onOpenChange}>
        <DialogContent className="w-150" finalFocus={finalFocus}>
          <DialogHeader>
            <DialogTitle>{t(($) => $['external.editInfo'])}</DialogTitle>
            <DialogDescription className="sr-only">
              {t(($) => $['roster.editDialog.description'])}
            </DialogDescription>
            <DialogHeaderCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <EditAgentInfo agent={agent} onSubmit={(fields) => onEdit(agent.key, fields)} />
        </DialogContent>
      </Dialog>
      <AlertDialog open={open && action !== 'edit'} onOpenChange={onOpenChange}>
        <AlertDialogContent finalFocus={finalFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {deleting && <p className="system-xs-regular text-text-tertiary">{agent.name}</p>}
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              {deleting
                ? t(($) => $['external.deleteDialog.description'], { name: agent.name })
                : agent.enabled
                  ? t(($) => $['external.disableDialog.description'])
                  : t(($) => $['external.enableDialog.description'])}
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancelButton variant="secondary">
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <Button
              variant="primary"
              tone={deleting ? 'destructive' : undefined}
              onClick={() => (deleting ? onDelete : onToggle)(agent.key)}
            >
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
          {deleting && agent.enabled && (
            <div className="flex flex-wrap items-center justify-center gap-1 border-t border-divider-subtle bg-background-soft px-2 py-3 system-xs-regular text-text-tertiary">
              <span>{t(($) => $['external.deleteDialog.pauseInstead'])}</span>
              <Button
                variant="ghost"
                size="small"
                className="h-auto p-0 text-text-accent"
                onClick={() => onRequest({ ...request, kind: 'toggle' })}
              >
                {t(($) => $['external.disable'])}
              </Button>
            </div>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
