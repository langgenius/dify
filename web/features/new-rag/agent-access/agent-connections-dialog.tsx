'use client'

import type {
  KnowledgeAgentGrantResponse,
  KnowledgeAgentTokenCreatedResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import type { KnowledgeBaseOption } from './knowledge-base-options'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/console'
import {
  agentAccessErrorCode,
  agentConnectCommands,
  DEFAULT_PERSONAL_TOKEN_EXPIRY_DAYS,
  PERSONAL_TOKEN_EXPIRY_DAYS,
  personalTokenSnippets,
  rejectedKnowledgeBaseIds,
} from './agent-access'
import { knowledgeBaseSummary, useKnowledgeBaseOptions } from './knowledge-base-options'
import { KnowledgeBasePicker } from './knowledge-base-picker'

type View =
  | { kind: 'overview' }
  | { kind: 'create' }
  | { kind: 'created'; result: KnowledgeAgentTokenCreatedResponse }
  | { kind: 'edit'; grant: KnowledgeAgentGrantResponse }

const NOTICE_CLASS_NAME = 'rounded-lg px-3 py-2 body-xs-regular'

/** "Agent connections" on the Agent Knowledge Base list. */
export function AgentConnectionsButton() {
  const { t } = useTranslation(['knowledgeSpace'])
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="medium" onClick={() => setOpen(true)}>
        <span aria-hidden className="i-ri-plug-line size-4 shrink-0" />
        <span className="max-sm:sr-only">{t(($) => $['agents.button'])}</span>
      </Button>
      <AgentConnectionsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

export function AgentConnectionsDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const [view, setView] = useState<View>({ kind: 'overview' })
  const mine = useQuery({
    ...consoleQuery.knowledgeFs.agentAccess.get.queryOptions({ context: { silent: true } }),
    enabled: open,
  })
  const knowledgeBases = useKnowledgeBaseOptions(open && mine.data?.available === true)
  const blocked = new Set(mine.data?.blocked_knowledge_base_ids ?? [])
  const pickerProps = {
    blocked,
    hasMore: knowledgeBases.query.hasNextPage,
    loadingMore: knowledgeBases.query.isFetchingNextPage,
    onLoadMore: () => void knowledgeBases.query.fetchNextPage(),
    options: knowledgeBases.options,
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setView({ kind: 'overview' })
      }}
    >
      <DialogContent className="w-160">
        <DialogHeader>
          <DialogTitle>
            {view.kind === 'create' || view.kind === 'created'
              ? t(($) => $['agents.createToken'])
              : view.kind === 'edit'
                ? t(($) => $['agents.editTitle'], { name: grantName(view.grant) })
                : t(($) => $['agents.title'])}
          </DialogTitle>
          <DialogDescription>
            {view.kind === 'create' || view.kind === 'created'
              ? t(($) => $['agents.createTokenDescription'])
              : view.kind === 'edit'
                ? t(($) => $['agents.chooseKnowledgeBases'])
                : t(($) => $['agents.description'])}
          </DialogDescription>
          <DialogHeaderCloseButton aria-label={tCommon(($) => $['operation.close'])} />
        </DialogHeader>
        {mine.isPending ? (
          <DialogBody>
            <p className={`${NOTICE_CLASS_NAME} bg-background-section text-text-tertiary`}>
              {t(($) => $['agents.loading'])}
            </p>
          </DialogBody>
        ) : mine.isError ? (
          <DialogBody className="flex flex-col items-start gap-3">
            <p role="alert" className="body-sm-regular text-text-destructive">
              {t(($) => $['agents.loadFailed'])}
            </p>
            <Button onClick={() => void mine.refetch()}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </DialogBody>
        ) : !mine.data.available ? (
          <DialogBody>
            <p className={`${NOTICE_CLASS_NAME} bg-background-section text-text-tertiary`}>
              {t(($) => $['agents.unavailable'])}
            </p>
          </DialogBody>
        ) : view.kind === 'create' ? (
          <CreateTokenForm
            knowledgeBases={pickerProps}
            onBack={() => setView({ kind: 'overview' })}
            onCreated={(result) => setView({ kind: 'created', result })}
          />
        ) : view.kind === 'created' ? (
          <TokenCreated
            mcpUrl={mine.data.mcp_url}
            result={view.result}
            onDone={() => setView({ kind: 'overview' })}
          />
        ) : view.kind === 'edit' ? (
          <EditGrantForm
            grant={view.grant}
            knowledgeBases={pickerProps}
            onDone={() => setView({ kind: 'overview' })}
          />
        ) : (
          <DialogBody className="flex flex-col gap-5">
            {!mine.data.agent_access_enabled && (
              <p
                role="status"
                className={`${NOTICE_CLASS_NAME} bg-state-warning-hover text-text-warning`}
              >
                {t(($) => $['agents.workspaceDisabled'])}
              </p>
            )}
            <ConnectSection mcpUrl={mine.data.mcp_url} />
            <Section
              title={t(($) => $['agents.connectionsTitle'])}
              description={t(($) => $['agents.connectionsDescription'])}
              action={
                <Button
                  size="small"
                  disabled={!mine.data.agent_access_enabled}
                  onClick={() => setView({ kind: 'create' })}
                >
                  <span aria-hidden className="i-ri-key-2-line size-3.5 shrink-0" />
                  {t(($) => $['agents.createToken'])}
                </Button>
              }
            >
              <GrantList
                emptyLabel={t(($) => $['agents.noConnections'])}
                grants={mine.data.grants}
                knowledgeBases={knowledgeBases.options}
                onEdit={(grant) => setView({ kind: 'edit', grant })}
              />
            </Section>
            <WorkspaceSection
              knowledgeBases={knowledgeBases.options}
              ownGrantIds={new Set(mine.data.grants.map((grant) => grant.id))}
            />
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  )
}

function grantName(grant: KnowledgeAgentGrantResponse) {
  return grant.client_name ?? grant.name
}

function Section({
  action,
  children,
  description,
  title,
}: {
  action?: ReactNode
  children: ReactNode
  description?: ReactNode
  title: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="system-sm-semibold text-text-primary">{title}</h3>
          {description && (
            <p className="mt-0.5 body-xs-regular text-text-tertiary">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="system-xs-medium text-text-tertiary">{label}</span>
      <div className="flex min-h-8 items-center gap-1 rounded-lg bg-components-input-bg-normal py-1 ps-3 pe-1">
        <code
          className="min-w-0 flex-1 truncate system-xs-medium text-text-secondary"
          title={value}
          translate="no"
        >
          {value}
        </code>
        <CopyFeedback content={value} />
      </div>
    </div>
  )
}

function ConnectSection({ mcpUrl }: { mcpUrl: string }) {
  const { t } = useTranslation(['knowledgeSpace'])
  const commands = agentConnectCommands(mcpUrl)
  return (
    <Section
      title={t(($) => $['agents.connectTitle'])}
      description={t(($) => $['agents.connectDescription'])}
    >
      <CopyLine label={t(($) => $['agents.mcpUrl'])} value={mcpUrl} />
      <CopyLine label="Claude Code" value={commands.claudeCode} />
      {commands.codex.map((command, index) => (
        <CopyLine key={command} label={index === 0 ? 'Codex' : ''} value={command} />
      ))}
      <p className="body-xs-regular text-text-tertiary">{t(($) => $['agents.readOnlyNote'])}</p>
    </Section>
  )
}

function useGrantError() {
  const { t } = useTranslation(['knowledgeSpace'])
  return (error: unknown, options: readonly KnowledgeBaseOption[]) => {
    const code = agentAccessErrorCode(error)
    const names = rejectedKnowledgeBaseIds(error)
      .map((id) => options.find((option) => option.id === id)?.name ?? id)
      .join(', ')
    if (code === 'knowledge_base_agent_access_blocked')
      return t(($) => $['agents.errorBlocked'], { names })
    if (code === 'invalid_knowledge_bases')
      return t(($) => $['agents.errorKnowledgeBases'], { names })
    if (code === 'agent_access_disabled') return t(($) => $['agents.workspaceDisabled'])
    return t(($) => $['agents.errorGeneric'])
  }
}

function useInvalidateAgentAccess() {
  const queryClient = useQueryClient()
  return () =>
    queryClient.invalidateQueries({ queryKey: consoleQuery.knowledgeFs.agentAccess.key() })
}

function GrantList({
  emptyLabel,
  grants,
  knowledgeBases,
  onEdit,
  showAccount,
}: {
  emptyLabel: string
  grants: KnowledgeAgentGrantResponse[]
  knowledgeBases: readonly KnowledgeBaseOption[]
  onEdit?: (grant: KnowledgeAgentGrantResponse) => void
  showAccount?: boolean
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const [revoking, setRevoking] = useState<KnowledgeAgentGrantResponse | null>(null)
  const invalidate = useInvalidateAgentAccess()
  const revoke = useMutation(
    consoleQuery.knowledgeFs.agentAccess.grants.byGrantId.delete.mutationOptions({
      onSuccess: async () => {
        setRevoking(null)
        await invalidate()
      },
    }),
  )
  const relative = (value: string) => {
    const time = Date.parse(value)
    return Number.isNaN(time) ? value : formatTimeFromNow(time)
  }

  if (grants.length === 0)
    return (
      <p className={`${NOTICE_CLASS_NAME} bg-background-section text-text-tertiary`}>
        {emptyLabel}
      </p>
    )
  return (
    <>
      <ul className="flex flex-col rounded-lg border-[0.5px] border-components-panel-border">
        {grants.map((grant) => {
          const { names, more } = knowledgeBaseSummary(grant.knowledge_base_ids, knowledgeBases)
          return (
            <li
              key={grant.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-divider-subtle px-3 py-2.5 last:border-b-0"
            >
              <div className="min-w-56 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate system-sm-semibold text-text-primary">
                    {showAccount && grant.account
                      ? `${grant.account.name || grant.account.email} · ${grantName(grant)}`
                      : grantName(grant)}
                  </span>
                  <span className="shrink-0 rounded-[5px] border border-divider-deep px-1 system-2xs-medium-uppercase text-text-tertiary">
                    {grant.kind === 'oauth'
                      ? t(($) => $['agents.kindOAuth'])
                      : t(($) => $['agents.kindToken'])}
                  </span>
                </div>
                <p className="mt-0.5 truncate system-xs-regular text-text-secondary">
                  {[
                    ...names,
                    ...(more > 0
                      ? [t(($) => $['agents.moreKnowledgeBases'], { number: more })]
                      : []),
                  ].join(', ')}
                </p>
                <p className="mt-0.5 system-xs-regular text-text-tertiary">
                  {grant.last_used_at
                    ? t(($) => $['agents.lastUsed'], { time: relative(grant.last_used_at) })
                    : t(($) => $['agents.neverUsed'])}
                  {grant.expires_at &&
                    ` · ${t(($) => $['agents.expires'], { time: relative(grant.expires_at) })}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                {onEdit && (
                  <Button size="small" onClick={() => onEdit(grant)}>
                    {t(($) => $['agents.editKnowledgeBases'])}
                  </Button>
                )}
                <Button size="small" tone="destructive" onClick={() => setRevoking(grant)}>
                  {t(($) => $['agents.disconnect'])}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
      <AlertDialog
        open={revoking !== null}
        onOpenChange={(next) => {
          if (!next && !revoke.isPending) {
            setRevoking(null)
            revoke.reset()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['agents.disconnectTitle'], { name: revoking ? grantName(revoking) : '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {showAccount && revoking?.account
                ? t(($) => $['agents.disconnectMemberDescription'], {
                    member: revoking.account.name || revoking.account.email,
                  })
                : t(($) => $['agents.disconnectDescription'])}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revoke.isError && (
            <p role="alert" className="px-6 body-xs-regular text-text-destructive">
              {t(($) => $['agents.errorGeneric'])}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancelButton disabled={revoke.isPending}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={revoke.isPending}
              onClick={() => revoking && revoke.mutate({ params: { grant_id: revoking.id } })}
            >
              {t(($) => $['agents.disconnect'])}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

type PickerProps = {
  blocked: ReadonlySet<string>
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  options: KnowledgeBaseOption[]
}

function CreateTokenForm({
  knowledgeBases,
  onBack,
  onCreated,
}: {
  knowledgeBases: PickerProps
  onBack: () => void
  onCreated: (result: KnowledgeAgentTokenCreatedResponse) => void
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const grantError = useGrantError()
  const invalidate = useInvalidateAgentAccess()
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [days, setDays] = useState<number>(DEFAULT_PERSONAL_TOKEN_EXPIRY_DAYS)
  const create = useMutation(
    consoleQuery.knowledgeFs.agentAccess.tokens.post.mutationOptions({
      context: { silent: true },
      onSuccess: async (result) => {
        onCreated(result)
        await invalidate()
      },
    }),
  )

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        if (create.isPending || !name.trim() || selected.length === 0) return
        create.mutate({
          body: { name: name.trim(), knowledge_base_ids: selected, expires_in_days: days },
        })
      }}
    >
      <DialogBody className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field name="agent-token-name">
            <FieldLabel>{t(($) => $['agents.tokenName'])}</FieldLabel>
            <Input
              autoComplete="off"
              maxLength={100}
              placeholder={t(($) => $['agents.tokenNamePlaceholder'])}
              value={name}
              onValueChange={setName}
            />
          </Field>
          <Select value={String(days)} onValueChange={(value) => value && setDays(Number(value))}>
            <div className="grid min-w-0 gap-1">
              <SelectLabel>{t(($) => $['agents.tokenExpiry'])}</SelectLabel>
              <SelectTrigger>{t(($) => $['agents.days'], { days })}</SelectTrigger>
            </div>
            <SelectContent>
              {PERSONAL_TOKEN_EXPIRY_DAYS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  <SelectItemText>{t(($) => $['agents.days'], { days: option })}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className="system-sm-medium text-text-secondary">
            {t(($) => $['agents.knowledgeBases'])}
          </span>
          <KnowledgeBasePicker
            {...knowledgeBases}
            disabled={create.isPending}
            value={selected}
            onChange={setSelected}
          />
        </div>
        {create.isError && (
          <p role="alert" className="body-xs-regular text-text-destructive">
            {grantError(create.error, knowledgeBases.options)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" disabled={create.isPending} onClick={onBack}>
          {t(($) => $['agents.back'])}
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending}
          disabled={!name.trim() || selected.length === 0}
        >
          {t(($) => $['agents.create'])}
        </Button>
      </DialogFooter>
    </form>
  )
}

function TokenCreated({
  mcpUrl,
  onDone,
  result,
}: {
  mcpUrl: string
  onDone: () => void
  result: KnowledgeAgentTokenCreatedResponse
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const snippets = personalTokenSnippets(mcpUrl)
  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <p
          role="status"
          className={`${NOTICE_CLASS_NAME} bg-state-warning-hover text-text-warning`}
        >
          {t(($) => $['agents.tokenCreated'])}
        </p>
        <CopyLine label={t(($) => $['agents.token'])} value={result.token} />
        <div className="flex flex-col gap-1">
          <span className="system-xs-medium text-text-tertiary">
            {t(($) => $['agents.tokenUsage'])}
          </span>
          <CopyLine label="Claude Code" value={snippets.claudeCode} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="system-xs-medium text-text-tertiary">
              Codex · ~/.codex/config.toml
            </span>
            <div className="flex items-start gap-1 rounded-lg bg-components-input-bg-normal py-1 ps-3 pe-1">
              <pre
                className="min-w-0 flex-1 overflow-x-auto py-1 system-xs-medium text-text-secondary"
                translate="no"
              >
                {snippets.codex}
              </pre>
              <CopyFeedback content={snippets.codex} />
            </div>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="primary" onClick={onDone}>
          {t(($) => $['agents.done'])}
        </Button>
      </DialogFooter>
    </>
  )
}

function EditGrantForm({
  grant,
  knowledgeBases,
  onDone,
}: {
  grant: KnowledgeAgentGrantResponse
  knowledgeBases: PickerProps
  onDone: () => void
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const grantError = useGrantError()
  const invalidate = useInvalidateAgentAccess()
  const [selected, setSelected] = useState<string[]>(() => grant.knowledge_base_ids)
  const save = useMutation(
    consoleQuery.knowledgeFs.agentAccess.grants.byGrantId.patch.mutationOptions({
      context: { silent: true },
      onSuccess: async () => {
        onDone()
        await invalidate()
      },
    }),
  )
  return (
    <>
      <DialogBody className="flex flex-col gap-4">
        <KnowledgeBasePicker
          {...knowledgeBases}
          disabled={save.isPending}
          value={selected}
          onChange={setSelected}
        />
        {save.isError && (
          <p role="alert" className="body-xs-regular text-text-destructive">
            {grantError(save.error, knowledgeBases.options)}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button disabled={save.isPending} onClick={onDone}>
          {t(($) => $['agents.back'])}
        </Button>
        <Button
          variant="primary"
          loading={save.isPending}
          disabled={selected.length === 0}
          onClick={() =>
            save.mutate({
              params: { grant_id: grant.id },
              body: { knowledge_base_ids: selected },
            })
          }
        >
          {tCommon(($) => $['operation.save'])}
        </Button>
      </DialogFooter>
    </>
  )
}

function WorkspaceSection({
  knowledgeBases,
  ownGrantIds,
}: {
  knowledgeBases: readonly KnowledgeBaseOption[]
  ownGrantIds: ReadonlySet<string>
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const isManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const invalidate = useInvalidateAgentAccess()
  const workspace = useQuery({
    ...consoleQuery.knowledgeFs.agentAccess.workspace.get.queryOptions({
      context: { silent: true },
    }),
    enabled: isManager,
  })
  const toggle = useMutation(
    consoleQuery.knowledgeFs.agentAccess.workspace.patch.mutationOptions({
      context: { silent: true },
      onSettled: () => invalidate(),
    }),
  )
  if (!isManager) return null

  return (
    <Section
      title={t(($) => $['agents.workspaceTitle'])}
      description={t(($) => $['agents.workspaceDescription'])}
    >
      {workspace.isPending ? (
        <p className={`${NOTICE_CLASS_NAME} bg-background-section text-text-tertiary`}>
          {t(($) => $['agents.loading'])}
        </p>
      ) : workspace.isError ? (
        <p role="alert" className="body-xs-regular text-text-destructive">
          {t(($) => $['agents.loadFailed'])}
        </p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-background-section px-3 py-2">
            <span className="system-sm-medium text-text-secondary">
              {t(($) => $['agents.allowAgents'])}
            </span>
            <Switch
              aria-label={t(($) => $['agents.allowAgents'])}
              checked={
                toggle.isPending
                  ? (toggle.variables?.body.enabled ?? false)
                  : workspace.data.agent_access_enabled
              }
              disabled={toggle.isPending}
              onCheckedChange={(enabled) => toggle.mutate({ body: { enabled } })}
            />
          </label>
          {toggle.isError && (
            <p role="alert" className="body-xs-regular text-text-destructive">
              {t(($) => $['agents.errorGeneric'])}
            </p>
          )}
          <h4 className="mt-1 system-xs-semibold-uppercase text-text-tertiary">
            {t(($) => $['agents.membersConnections'])}
          </h4>
          <GrantList
            showAccount
            emptyLabel={t(($) => $['agents.noMemberConnections'])}
            grants={workspace.data.grants.filter((grant) => !ownGrantIds.has(grant.id))}
            knowledgeBases={knowledgeBases}
          />
        </>
      )}
    </Section>
  )
}
