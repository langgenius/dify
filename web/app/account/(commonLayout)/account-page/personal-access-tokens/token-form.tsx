import type {
  PersonalAccessTokenCreatePayload,
  PersonalAccessTokenDetailResponse,
  PersonalAccessTokenResourceResponse,
  PersonalAccessTokenResponse,
  PersonalAccessTokenWorkspaceResponse,
} from '@dify/contracts/api/console/account/types.gen'
import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { DialogClose, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import ResourcePicker from './resource-picker'
import { useTokenClipboard } from './use-token-clipboard'
import WorkspacePicker from './workspace-picker'

export default function TokenForm({
  initial: initialData,
  onReload,
  duplicate = false,
  onSaved,
}: {
  initial?: PersonalAccessTokenDetailResponse
  duplicate?: boolean
  onSaved?: () => void
  onReload?: () => Promise<void>
}) {
  const { t, i18n } = useTranslation(['accountSettings', 'common'])
  const docLink = useDocLink()
  // The draft and its optimistic-lock version belong to the same editing session.
  const [initial] = useState(initialData)
  const [reloading, setReloading] = useState(false)
  const isEdit = initial !== undefined && !duplicate
  const editExpired = isEdit && initialData?.token.status === 'expired'
  const excludedResources = duplicate
    ? (initial?.resources.filter((resource) => !resource.available).length ?? 0)
    : 0
  const excludedWorkspaces = duplicate
    ? (initial?.workspaces.filter((workspace) => !workspace.available).length ?? 0)
    : 0
  const excludedItems = [
    excludedResources > 0
      ? t(($) => $['personalAccessToken.resourcesCount'], { count: excludedResources })
      : null,
    excludedWorkspaces > 0
      ? t(($) => $['personalAccessToken.workspacesCount'], { count: excludedWorkspaces })
      : null,
  ]
    .flatMap((item) => (item === null ? [] : [item]))
    .join(' and ')
  const [name, setName] = useState(initial?.token.name ?? '')
  const [expiration, setExpiration] =
    useState<NonNullable<PersonalAccessTokenCreatePayload['expiration']>>('90_days')
  const [resourceMode, setResourceMode] = useState(initial?.token.resource_scope_mode ?? 'all')
  const [workspaceMode, setWorkspaceMode] = useState(initial?.token.workspace_scope_mode ?? 'all')
  const [resources, setResources] = useState<PersonalAccessTokenResourceResponse[]>(
    initial?.resources.filter((item) => !duplicate || item.available) ?? [],
  )
  const [workspaces, setWorkspaces] = useState<PersonalAccessTokenWorkspaceResponse[]>(
    initial?.workspaces.filter((item) => !duplicate || item.available) ?? [],
  )
  const [expanded, setExpanded] = useState<'resources' | 'workspaces'>('resources')
  const [created, setCreated] = useState<PersonalAccessTokenResponse | null>(null)
  const { copied, failed: copyFailed, copySecret } = useTokenClipboard()
  const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null)
  const create = useMutation(
    consoleQuery.account.personalAccessTokens.post.mutationOptions({ context: { silent: true } }),
  )
  const update = useMutation(
    consoleQuery.account.personalAccessTokens.byTokenId.patch.mutationOptions({
      context: { silent: true },
    }),
  )
  const secret = useMutation(
    consoleQuery.account.personalAccessTokens.byTokenId.secret.post.mutationOptions({
      gcTime: 0,
      context: { silent: true },
    }),
  )
  const options = [
    { value: '30_days', label: t(($) => $['personalAccessToken.days'], { count: 30 }) },
    { value: '90_days', label: t(($) => $['personalAccessToken.days'], { count: 90 }) },
    { value: '180_days', label: t(($) => $['personalAccessToken.days'], { count: 180 }) },
    { value: '365_days', label: t(($) => $['personalAccessToken.days'], { count: 365 }) },
    { value: 'never', label: t(($) => $['personalAccessToken.never']) },
  ] satisfies {
    value: NonNullable<PersonalAccessTokenCreatePayload['expiration']>
    label: string
  }[]
  const validScope =
    (resourceMode !== 'selected' || resources.length > 0) &&
    (workspaceMode !== 'selected' || workspaces.length > 0)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim() || !validScope || editExpired) return
    const body: PersonalAccessTokenCreatePayload = {
      name: name.trim(),
      expiration,
      resource_scope: {
        mode: resourceMode,
        resources:
          resourceMode === 'selected'
            ? resources.map(({ resource_id, resource_type }) => ({ resource_id, resource_type }))
            : [],
      },
      workspace_scope: {
        mode: workspaceMode,
        workspace_ids:
          workspaceMode === 'selected' ? workspaces.map((item) => item.workspace_id) : [],
      },
    }
    const fingerprint = JSON.stringify(body)
    if (isEdit) {
      update.mutate(
        {
          params: { token_id: initial.token.id },
          body: {
            name: body.name,
            resource_scope: body.resource_scope,
            workspace_scope: body.workspace_scope,
            version: initial.token.version,
          },
        },
        { onSuccess: onSaved },
      )
      return
    }
    if (attemptRef.current?.fingerprint !== fingerprint)
      attemptRef.current = { fingerprint, key: crypto.randomUUID() }
    create.mutate(
      { body, headers: { 'Idempotency-Key': attemptRef.current.key } },
      {
        onSuccess: (token) => {
          setCreated(token)
          secret.mutate({ params: { token_id: token.id } })
        },
      },
    )
  }
  return (
    <>
      <div className="px-6 pt-6 pr-14 pb-3">
        <DialogTitle>
          {created
            ? t(($) => $['personalAccessToken.createdTitle'])
            : isEdit
              ? t(($) => $['personalAccessToken.editTitle'])
              : duplicate
                ? t(($) => $['personalAccessToken.duplicateTitle'])
                : t(($) => $['personalAccessToken.createTitle'])}
        </DialogTitle>
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              className="absolute top-5 right-5"
            >
              <span aria-hidden="true" className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
      </div>
      {created ? (
        <div data-pat-created className="px-6 pb-5">
          <p className="mb-6 system-sm-regular text-text-secondary">
            {created.name} · {t(($) => $['personalAccessToken.expires'])}{' '}
            {created.expires_at
              ? new Date(created.expires_at).toLocaleDateString(i18n.language)
              : t(($) => $['personalAccessToken.never'])}
          </p>
          {secret.data ? (
            <div className="flex items-center gap-2">
              <Input
                aria-label={t(($) => $['resourceAccessToken.token'])}
                readOnly
                value={secret.data.secret}
                className="font-mono"
              />
              <Button
                variant="primary"
                onClick={() => {
                  if (secret.data) return copySecret(secret.data.secret)
                }}
              >
                {copied
                  ? t(($) => $['operation.copied'], { ns: 'common' })
                  : t(($) => $['operation.copy'], { ns: 'common' })}
              </Button>
            </div>
          ) : (
            <Button
              loading={secret.isPending}
              onClick={() => secret.mutate({ params: { token_id: created.id } })}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          )}
          {copyFailed && (
            <p role="alert" className="mt-2 system-xs-regular text-text-warning">
              {t(($) => $['operation.copyErrorFailed'], { ns: 'common' })}
            </p>
          )}
          {secret.isError && (
            <p role="alert" className="mt-2 system-xs-regular text-text-warning">
              {t(($) => $['personalAccessToken.secretUnavailable'])}
            </p>
          )}
          <p className="mt-2 system-xs-regular text-text-tertiary">
            {t(($) => $['personalAccessToken.copyNow'])}
          </p>
          <div className="mt-12 flex items-center justify-between gap-4">
            <a
              href={docLink('/api-reference/guides/get-started')}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-1 system-xs-medium text-text-accent hover:underline"
            >
              {t(($) => $['personalAccessToken.howToUseIt'])}
              <span aria-hidden="true" className="i-ri-arrow-right-up-line size-3" />
            </a>
          </div>
          <div className="mt-6 flex justify-end">
            <DialogClose render={<Button />}>{t(($) => $['resourceAccessToken.done'])}</DialogClose>
          </div>
        </div>
      ) : (
        <form onSubmit={submit}>
          <div className="space-y-5 px-6 py-3">
            {duplicate && (
              <p className="system-xs-regular text-text-tertiary">
                {t(($) => $['personalAccessToken.duplicateDescription'])}
              </p>
            )}
            {duplicate && excludedItems && (
              <p className="system-xs-regular text-text-warning">
                {t(($) => $['personalAccessToken.excludedAccess'], { items: excludedItems })}
              </p>
            )}
            <div className="flex flex-wrap gap-4">
              <Field name="name" className="min-w-48 flex-1">
                <FieldLabel>{t(($) => $['resourceAccessToken.name'])}</FieldLabel>
                <Input
                  required
                  maxLength={255}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              {!isEdit && (
                <div className="w-49.25">
                  <Select
                    value={expiration}
                    items={options}
                    onValueChange={(value) => {
                      if (value) setExpiration(value)
                    }}
                  >
                    <SelectLabel>{t(($) => $['personalAccessToken.expiration'])}</SelectLabel>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <SelectItemText>{option.label}</SelectItemText>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 border-t border-components-panel-border pt-4">
              <h3
                id="pat-call-apps"
                className="col-span-2 mb-2 system-sm-semibold text-text-secondary"
              >
                {t(($) => $['resourceAccessToken.resources'])}
              </h3>
              <SegmentedControl
                aria-labelledby="pat-call-apps"
                value={resourceMode}
                onValueChange={(value) => {
                  setResourceMode(value)
                  if (value === 'selected' || workspaceMode === 'selected') setExpanded('resources')
                }}
              >
                <SegmentedControlItem value="all" className="data-checked:text-text-primary">
                  {t(($) => $['resourceAccessToken.tabAll'])}
                </SegmentedControlItem>
                <SegmentedControlItem value="selected" className="data-checked:text-text-primary">
                  {t(($) => $['personalAccessToken.selected'])}
                  {resourceMode === 'selected' && resources.length > 0 && (
                    <span
                      aria-hidden
                      className="ml-1 rounded border border-divider-deep px-1 system-2xs-medium text-text-tertiary"
                    >
                      {resources.length}
                    </span>
                  )}
                </SegmentedControlItem>
                <SegmentedControlItem value="none" className="data-checked:text-text-primary">
                  {t(($) => $['personalAccessToken.none'])}
                </SegmentedControlItem>
              </SegmentedControl>
              {resourceMode === 'selected' && expanded === 'resources' && (
                <ResourcePicker
                  selected={resources}
                  onToggle={(resource) =>
                    setResources((current) =>
                      current.some(
                        (item) =>
                          item.resource_type === resource.resource_type &&
                          item.resource_id === resource.resource_id,
                      )
                        ? current.filter(
                            (item) =>
                              item.resource_type !== resource.resource_type ||
                              item.resource_id !== resource.resource_id,
                          )
                        : [...current, resource],
                    )
                  }
                />
              )}
              {resourceMode === 'selected' ? (
                expanded !== 'resources' && (
                  <Button
                    className="col-span-2 mt-2 justify-self-start"
                    variant="ghost-accent"
                    onClick={() => setExpanded('resources')}
                  >
                    {t(($) => $['operation.selectCount'], {
                      ns: 'common',
                      count: resources.length,
                    })}{' '}
                    · {t(($) => $['operation.edit'], { ns: 'common' })}
                  </Button>
                )
              ) : (
                <p className="col-span-2 mt-2 system-xs-regular text-text-tertiary">
                  {resourceMode === 'all'
                    ? t(($) => $['personalAccessToken.allIncludingFuture'])
                    : resourceMode === 'none'
                      ? t(($) => $['personalAccessToken.noResourceCalls'])
                      : t(($) => $['personalAccessToken.scopeRequired'])}
                </p>
              )}
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 border-t border-components-panel-border pt-4">
              <h3
                id="pat-manage-workspaces"
                className="col-span-2 mb-2 system-sm-semibold text-text-secondary"
              >
                {t(($) => $['personalAccessToken.manageWorkspaces'])}
              </h3>
              <SegmentedControl
                aria-labelledby="pat-manage-workspaces"
                value={workspaceMode}
                onValueChange={(value) => {
                  setWorkspaceMode(value)
                  if (value === 'selected' || resourceMode === 'selected') setExpanded('workspaces')
                }}
              >
                <SegmentedControlItem value="all" className="data-checked:text-text-primary">
                  {t(($) => $['resourceAccessToken.tabAll'])}
                </SegmentedControlItem>
                <SegmentedControlItem value="selected" className="data-checked:text-text-primary">
                  {t(($) => $['personalAccessToken.selected'])}
                  {workspaceMode === 'selected' && workspaces.length > 0 && (
                    <span
                      aria-hidden
                      className="ml-1 rounded border border-divider-deep px-1 system-2xs-medium text-text-tertiary"
                    >
                      {workspaces.length}
                    </span>
                  )}
                </SegmentedControlItem>
                <SegmentedControlItem value="none" className="data-checked:text-text-primary">
                  {t(($) => $['personalAccessToken.none'])}
                </SegmentedControlItem>
              </SegmentedControl>
              {workspaceMode === 'selected' && expanded === 'workspaces' && (
                <WorkspacePicker
                  selected={workspaces}
                  onToggle={(workspace) =>
                    setWorkspaces((current) =>
                      current.some((item) => item.workspace_id === workspace.workspace_id)
                        ? current.filter((item) => item.workspace_id !== workspace.workspace_id)
                        : [...current, workspace],
                    )
                  }
                />
              )}
              {workspaceMode === 'selected' ? (
                expanded !== 'workspaces' && (
                  <Button
                    className="col-span-2 mt-2 justify-self-start"
                    variant="ghost-accent"
                    onClick={() => setExpanded('workspaces')}
                  >
                    {t(($) => $['operation.selectCount'], {
                      ns: 'common',
                      count: workspaces.length,
                    })}{' '}
                    · {t(($) => $['operation.edit'], { ns: 'common' })}
                  </Button>
                )
              ) : (
                <p className="col-span-2 mt-2 system-xs-regular text-text-tertiary">
                  {workspaceMode === 'all'
                    ? t(($) => $['personalAccessToken.allIncludingFuture'])
                    : workspaceMode === 'none'
                      ? t(($) => $['personalAccessToken.noWorkspaceOperations'])
                      : t(($) => $['personalAccessToken.scopeRequired'])}
                </p>
              )}
            </div>
            {!validScope && (
              <p role="alert" className="system-xs-regular text-text-warning">
                {t(($) => $['personalAccessToken.scopeRequired'])}
              </p>
            )}
          </div>
          {(create.isError ||
            (update.isError && !editExpired && getHttpErrorStatus(update.error) !== 409)) && (
            <p role="alert" className="px-6 system-xs-regular text-text-warning">
              {getHttpErrorStatus(create.error) === 503 && create.error instanceof Error
                ? create.error.message
                : t(($) => $['api.actionFailed'], { ns: 'common' })}
            </p>
          )}
          {editExpired && (
            <p role="alert" className="px-6 system-xs-regular text-text-warning">
              {t(($) => $['personalAccessToken.expired'])}
            </p>
          )}
          {getHttpErrorStatus(update.error) === 409 && onReload && (
            <div role="alert" className="px-6 py-2">
              <p className="system-xs-regular text-text-warning">
                {t(($) => $['personalAccessToken.conflict'])}
              </p>
              <Button
                loading={reloading}
                onClick={async () => {
                  setReloading(true)
                  try {
                    await onReload()
                  } finally {
                    setReloading(false)
                  }
                }}
              >
                {t(($) => $['personalAccessToken.reload'])}
              </Button>
            </div>
          )}
          <div className="flex justify-end gap-2 px-6 py-4">
            <DialogClose render={<Button />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <Button
              type="submit"
              variant="primary"
              loading={create.isPending || update.isPending}
              disabled={!name.trim() || !validScope || editExpired}
            >
              {isEdit
                ? t(($) => $['operation.save'], { ns: 'common' })
                : t(($) => $['operation.create'], { ns: 'common' })}
            </Button>
          </div>
        </form>
      )}
    </>
  )
}
