'use client'

import type {
  ExternalAgentAssetResponse,
  ExternalAgentInfoPayload,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { RefObject } from 'react'
import type { ExternalAgentListItem } from './external-agent-list'
import type { IconPickerInputValue } from '@/app/components/base/icon-picker'
import { Alert, AlertTitle } from '@langgenius/dify-ui/alert'
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
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { IconPicker, IconPickerContent, IconPickerTrigger } from '@/app/components/base/icon-picker'
import { SkeletonRectangle } from '@/app/components/base/skeleton'
import { toExternalAgentListItem } from '@/features/agent-v2/external-agent/model'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { externalAgentErrorMessage } from './external-connection-verification'

export type ExternalAgentActionRequest = {
  kind: 'edit' | 'toggle' | 'delete'
  agent: ExternalAgentListItem
  trigger: HTMLButtonElement | null
  adjacentFocusTargets: HTMLElement[]
}

type AgentInfo = Pick<ExternalAgentAssetResponse, 'name' | 'role' | 'description'> &
  Pick<ExternalAgentListItem, 'icon'>

function getPickerIcon(icon: ExternalAgentListItem['icon']): IconPickerInputValue | undefined {
  if (!icon) return undefined
  if (icon.icon_type === 'image') {
    if (!icon.icon_url) return undefined
    return icon.icon
      ? { type: 'image', fileId: icon.icon, url: icon.icon_url }
      : { type: 'link', url: icon.icon_url }
  }
  if (icon.icon_type === 'link') return icon.icon ? { type: 'link', url: icon.icon } : undefined
  return icon.icon
    ? { type: 'emoji', icon: icon.icon, background: icon.icon_background }
    : undefined
}

function EditAgentInfo({
  asset,
  pending,
  error,
  onSubmit,
  onReload,
}: {
  asset: ExternalAgentAssetResponse
  pending: boolean
  error: unknown
  onSubmit: (base: ExternalAgentAssetResponse, fields: AgentInfo) => void
  onReload: () => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const [base] = useState(asset)
  const [icon, setIcon] = useState(() => toExternalAgentListItem(base).icon)
  return (
    <Form<Pick<AgentInfo, 'name' | 'role' | 'description'>>
      className="contents"
      onFormSubmit={(fields) => {
        if (!pending)
          onSubmit(base, {
            name: fields.name.trim(),
            role: fields.role.trim(),
            description: fields.description,
            icon,
          })
      }}
    >
      <DialogBody className="space-y-4">
        <div className="flex items-end gap-4">
          <IconPicker
            value={getPickerIcon(icon)}
            onValueChange={(selection) =>
              setIcon(
                selection.type === 'emoji'
                  ? {
                      icon_type: 'emoji',
                      icon: selection.icon,
                      icon_background: selection.background,
                    }
                  : { icon_type: 'image', icon: selection.fileId, icon_url: selection.url },
              )
            }
          >
            <IconPickerTrigger
              disabled={pending}
              aria-label={t(($) => $['roster.createForm.changeIcon'])}
              className="group/icon relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-full"
            >
              <AppIcon
                icon={icon}
                size="xxl"
                shape="circle"
                className="size-16"
                fallback={{
                  content: (
                    <span aria-hidden className="i-ri-robot-2-line size-8 text-text-tertiary" />
                  ),
                  background: 'var(--color-components-icon-bg-midnight-soft)',
                }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#1a2133]/60 opacity-0 transition-opacity group-hover/icon:opacity-100 group-focus-visible/icon:opacity-100 motion-reduce:transition-none"
              >
                <span className="i-ri-edit-line size-5 text-text-primary-on-surface" />
              </span>
            </IconPickerTrigger>
            <IconPickerContent />
          </IconPicker>
          <Field
            name="name"
            disabled={pending}
            className="min-w-0 flex-1 pb-1"
            validate={(value) =>
              typeof value === 'string' && value.trim()
                ? null
                : t(($) => $['roster.createForm.nameRequired'])
            }
          >
            <FieldLabel>{t(($) => $['roster.createForm.nameLabel'])}</FieldLabel>
            <Input autoComplete="off" defaultValue={base.name} maxLength={255} required />
            <FieldError match="valueMissing">
              {t(($) => $['roster.createForm.nameRequired'])}
            </FieldError>
            <FieldError match="customError" />
          </Field>
        </div>
        <Field name="role" disabled={pending}>
          <FieldLabel>
            {t(($) => $['roster.createForm.roleLabel'])}
            <span className="ms-1 system-xs-regular text-text-tertiary">
              {t(($) => $['label.optional'], { ns: 'common' })}
            </span>
          </FieldLabel>
          <Input autoComplete="off" defaultValue={base.role} maxLength={255} />
        </Field>
        <Field name="description" disabled={pending}>
          <FieldLabel>{t(($) => $['roster.createForm.descriptionLabel'])}</FieldLabel>
          <Textarea className="h-22" defaultValue={base.description} maxLength={10000} />
          <FieldDescription>{t(($) => $['external.editDialog.descriptionHint'])}</FieldDescription>
        </Field>
        {Boolean(error) && (
          <Alert type="error">
            <AlertTitle>
              {getHttpErrorStatus(error) === 409
                ? t(($) => $['external.api.conflict'])
                : externalAgentErrorMessage(
                    error,
                    t(($) => $['external.api.saveFailed']),
                  )}
            </AlertTitle>
            {getHttpErrorStatus(error) === 409 && (
              <Button variant="secondary" size="small" onClick={onReload}>
                {t(($) => $['external.api.loadLatest'])}
              </Button>
            )}
          </Alert>
        )}
      </DialogBody>
      <DialogFooter>
        <DialogClose disabled={pending} render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button type="submit" variant="primary" loading={pending}>
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </Form>
  )
}

function EditAgentInfoLoader({
  agentId,
  pending,
  error,
  onSubmit,
  onReset,
}: {
  agentId: string
  pending: boolean
  error: unknown
  onSubmit: (base: ExternalAgentAssetResponse, fields: AgentInfo) => void
  onReset: () => void
}) {
  const detail = useQuery(
    consoleQuery.externalAgents.byAgentId.get.queryOptions({
      input: { params: { agent_id: agentId } },
    }),
  )
  const [reload, setReload] = useState(0)
  if (!detail.data)
    return (
      <DialogBody>{detail.isPending && <SkeletonRectangle className="h-40 w-full" />}</DialogBody>
    )
  return (
    <EditAgentInfo
      key={reload}
      asset={detail.data.asset}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onReload={() => {
        void detail.refetch().then((result) => {
          if (result.data && !result.error) {
            onReset()
            setReload((current) => current + 1)
          }
        })
      }}
    />
  )
}

type ExternalAgentActionsProps = {
  request: ExternalAgentActionRequest | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  fallbackFocus: RefObject<HTMLElement | null>
  onRequest: (request: ExternalAgentActionRequest) => void
  onDeleted?: () => void
}

export function ExternalAgentActions({
  request,
  open,
  onOpenChange,
  fallbackFocus,
  onRequest,
  onDeleted,
}: ExternalAgentActionsProps) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const update = useMutation(
    consoleQuery.externalAgents.byAgentId.info.patch.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const toggle = useMutation(
    consoleQuery.externalAgents.byAgentId.enabled.put.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const deletion = useMutation(
    consoleQuery.externalAgents.byAgentId.delete.mutationOptions({
      context: { silent: true },
      retry: false,
    }),
  )
  const references = useQuery(
    consoleQuery.externalAgents.byAgentId.references.get.queryOptions({
      input:
        request && request.kind === 'delete'
          ? { params: { agent_id: request.agent.key } }
          : skipToken,
      enabled: open && request?.kind === 'delete',
    }),
  )
  if (!request) return null
  const { agent, kind: action } = request
  const deleting = action === 'delete'
  const pending = update.isPending || toggle.isPending || deletion.isPending
  const error = deleting ? deletion.error : toggle.error
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
  const changeOpen = (next: boolean, details: { cancel: () => void }) => {
    if (pending) details.cancel()
    else onOpenChange(next)
  }
  const reset = (next: boolean) => {
    if (!next) {
      update.reset()
      toggle.reset()
      deletion.reset()
    }
  }

  return (
    <>
      <Dialog
        open={open && action === 'edit'}
        onOpenChange={changeOpen}
        onOpenChangeComplete={reset}
      >
        <DialogContent className="w-150" finalFocus={finalFocus}>
          <DialogHeader>
            <DialogTitle>{t(($) => $['external.editInfo'])}</DialogTitle>
            <DialogDescription className="sr-only">
              {t(($) => $['roster.editDialog.description'])}
            </DialogDescription>
            <DialogHeaderCloseButton
              disabled={pending}
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            />
          </DialogHeader>
          <EditAgentInfoLoader
            agentId={agent.key}
            pending={update.isPending}
            error={update.error}
            onReset={update.reset}
            onSubmit={(base, fields) => {
              const changes: ExternalAgentInfoPayload['changes'] = {}
              for (const key of ['name', 'role', 'description'] as const)
                if (fields[key] !== base[key]) changes[key] = fields[key]
              for (const key of ['icon_type', 'icon', 'icon_background'] as const) {
                const value = fields.icon?.[key] ?? null
                if (value !== base[key]) changes[key] = value
              }
              update.mutate(
                {
                  params: { agent_id: base.id },
                  body: { expected_revision: base.metadata_revision, changes },
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={open && action !== 'edit'}
        onOpenChange={changeOpen}
        onOpenChangeComplete={reset}
      >
        <AlertDialogContent finalFocus={finalFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {deleting && <p className="system-xs-regular text-text-tertiary">{agent.name}</p>}
          </AlertDialogHeader>
          <AlertDialogBody>
            {deleting ? (
              <>
                {references.data && (
                  <AlertDialogDescription render={<div />}>
                    <p>
                      <Trans
                        i18nKey={($) => $['external.deleteDialog.usage']}
                        ns="agentRoster"
                        count={references.data.apps.length}
                        values={{ count: references.data.apps.length }}
                        components={{ apps: <span className="system-md-semibold" /> }}
                      />
                    </p>
                    {references.data.may_have_in_flight && (
                      <p className="mt-2">{t(($) => $['external.api.inFlight'])}</p>
                    )}
                    <p className="mt-2 text-text-tertiary">
                      {t(($) => $['external.deleteDialog.retention'])}
                    </p>
                  </AlertDialogDescription>
                )}
                {references.isPending && <SkeletonRectangle className="h-20 w-full" />}
              </>
            ) : (
              <AlertDialogDescription>
                {agent.enabled
                  ? t(($) => $['external.disableDialog.description'])
                  : t(($) => $['external.enableDialog.description'])}
              </AlertDialogDescription>
            )}
            {Boolean(error) && (
              <Alert type="error">
                <AlertTitle>
                  {externalAgentErrorMessage(
                    error,
                    t(($) => $['external.api.saveFailed']),
                  )}
                </AlertTitle>
              </Alert>
            )}
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={pending} variant="secondary" size="large">
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <Button
              variant="primary"
              size="large"
              tone={deleting ? 'destructive' : undefined}
              loading={pending}
              disabled={
                deleting && (!references.data || references.isFetching || references.isError)
              }
              onClick={() => {
                if (pending) return
                if (deleting)
                  deletion.mutate(
                    { params: { agent_id: agent.key } },
                    {
                      onSuccess: () => {
                        onOpenChange(false)
                        onDeleted?.()
                      },
                    },
                  )
                else
                  toggle.mutate(
                    { params: { agent_id: agent.key }, body: { enabled: !agent.enabled } },
                    { onSuccess: () => onOpenChange(false) },
                  )
              }}
            >
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
          {deleting && agent.enabled && (
            <div className="flex shrink-0 flex-wrap items-center justify-center gap-1 rounded-b-2xl border-t border-divider-subtle bg-background-soft px-2 py-3 system-xs-regular text-text-tertiary">
              <span>{t(($) => $['external.deleteDialog.pauseInstead'])}</span>
              <Button
                variant="ghost"
                size="small"
                disabled={pending}
                className="h-auto p-0 system-xs-regular text-text-accent"
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
