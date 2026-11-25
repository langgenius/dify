'use client'

import type {
  ExternalAgentAssetResponse,
  ExternalAgentInfoPayload,
} from '@dify/contracts/api/console/external-agents/types.gen'
import type { RefObject } from 'react'
import type { ExternalAgentListItem } from './external-agent-list'
import type { IconPickerInputValue } from '@/app/components/base/icon-picker'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import {
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
import { skipToken, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import { IconPicker, IconPickerContent, IconPickerTrigger } from '@/app/components/base/icon-picker'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { toExternalAgentListItem } from '@/features/agent-v2/external-agent/model'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { externalAgentErrorMessage } from './external-connection-verification'

export type ExternalAgentEditRequest = {
  agent: ExternalAgentListItem
  trigger: HTMLButtonElement | null
  adjacentFocusTargets: HTMLElement[]
}

export type ExternalAgentConfirmationRequest = ExternalAgentEditRequest & {
  kind: 'toggle' | 'delete'
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
                  content: '🔗',
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
  const activeRef = useRef(false)
  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])
  if (!detail.data)
    return <DialogBody>{detail.isPending && <LoadingPlaceholder className="h-40" />}</DialogBody>
  return (
    <EditAgentInfo
      key={reload}
      asset={detail.data.asset}
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      onReload={() => {
        void detail.refetch().then((result) => {
          if (activeRef.current && result.data && !result.error) {
            onReset()
            setReload((current) => current + 1)
          }
        })
      }}
    />
  )
}

export function ExternalAgentEditDialogContent({
  agent,
  pending,
  error,
  onReset,
  onSubmit,
}: {
  agent: ExternalAgentListItem
  pending: boolean
  error: unknown
  onReset: () => void
  onSubmit: (input: { params: { agent_id: string }; body: ExternalAgentInfoPayload }) => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  return (
    <DialogContent className="w-150">
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
        pending={pending}
        error={error}
        onReset={onReset}
        onSubmit={(base, fields) => {
          const changes: ExternalAgentInfoPayload['changes'] = {}
          for (const key of ['name', 'role', 'description'] as const)
            if (fields[key] !== base[key]) changes[key] = fields[key]
          for (const key of ['icon_type', 'icon', 'icon_background'] as const) {
            const value = fields.icon?.[key] ?? null
            if (value !== base[key]) changes[key] = value
          }
          onSubmit({
            params: { agent_id: base.id },
            body: { expected_revision: base.metadata_revision, changes },
          })
        }}
      />
    </DialogContent>
  )
}

export function ExternalAgentConfirmationContent({
  request,
  pending,
  error,
  fallbackFocus,
  onConfirm,
  onPauseInstead,
}: {
  request: ExternalAgentConfirmationRequest
  pending: boolean
  error: unknown
  fallbackFocus: RefObject<HTMLElement | null>
  onConfirm: () => void
  onPauseInstead: () => void
}) {
  const finalFocus = () => {
    if (request.trigger?.isConnected) return true
    const target =
      request.adjacentFocusTargets.find((target) => target.isConnected) ?? fallbackFocus.current
    if (!target) return true
    target.focus({ preventScroll: true })
    return false
  }
  return (
    <AlertDialogContent finalFocus={finalFocus}>
      <ExternalAgentConfirmationSession
        request={request}
        pending={pending}
        error={error}
        onConfirm={onConfirm}
        onPauseInstead={onPauseInstead}
      />
    </AlertDialogContent>
  )
}

function ExternalAgentConfirmationSession({
  request,
  pending,
  error,
  onConfirm,
  onPauseInstead,
}: {
  request: ExternalAgentConfirmationRequest
  pending: boolean
  error: unknown
  onConfirm: () => void
  onPauseInstead: () => void
}) {
  const { t } = useTranslation(['agentRoster', 'common'])
  const { agent, kind } = request
  const deleting = kind === 'delete'
  const references = useQuery(
    consoleQuery.externalAgents.byAgentId.references.get.queryOptions({
      input: deleting ? { params: { agent_id: agent.key } } : skipToken,
      retry: false,
    }),
  )
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
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {deleting && <p className="system-xs-regular text-text-tertiary">{agent.name}</p>}
      </AlertDialogHeader>
      <AlertDialogBody>
        {deleting ? (
          <>
            {references.isError ? (
              <Alert type="error">
                <AlertTitle>{t(($) => $['external.deleteDialog.impactLoadFailed'])}</AlertTitle>
                <AlertActions>
                  <Button
                    variant="secondary"
                    size="small"
                    loading={references.isFetching}
                    onClick={() => void references.refetch()}
                  >
                    {t(($) => $['operation.retry'], { ns: 'common' })}
                  </Button>
                </AlertActions>
              </Alert>
            ) : references.data ? (
              <AlertDialogDescription render={<div />}>
                <p>
                  <Trans
                    i18nKey={($) => $['external.deleteDialog.usage']}
                    ns="agentRoster"
                    count={references.data.apps.length}
                    values={{ count: references.data.apps.length }}
                    components={{ apps: <span className="system-md-semibold" /> }}
                  />
                  {references.data.may_have_in_flight && (
                    <> {t(($) => $['external.api.inFlight'])}</>
                  )}
                </p>
                <p className="mt-2 text-text-tertiary">
                  {t(($) => $['external.deleteDialog.retention'])}
                </p>
              </AlertDialogDescription>
            ) : (
              references.isPending && <LoadingPlaceholder className="h-20" />
            )}
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
      <AlertDialogFooter spacing={deleting ? 'compact' : 'default'}>
        <AlertDialogCancelButton disabled={pending} variant="secondary" size="large">
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </AlertDialogCancelButton>
        <Button
          variant="primary"
          size="large"
          tone={deleting ? 'destructive' : undefined}
          loading={pending}
          disabled={deleting && (!references.data || references.isFetching || references.isError)}
          onClick={() => {
            if (pending) return
            onConfirm()
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
            onClick={() => onPauseInstead()}
          >
            {t(($) => $['external.disable'])}
          </Button>
        </div>
      )}
    </>
  )
}
