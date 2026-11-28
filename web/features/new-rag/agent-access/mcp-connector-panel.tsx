'use client'

import type {
  KnowledgeAgentGrantResponse,
  KnowledgeAgentTokenCreatedResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ReactNode } from 'react'
import type { KnowledgeBaseOption } from './knowledge-base-options'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Switch } from '@langgenius/dify-ui/switch'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyFeedback } from '@/app/components/base/copy-feedback'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleQuery } from '@/service/console'
import { AgentIcon } from './agent-icon'
import { AGENTS } from './agents'
import { grantName, useInvalidateAgentAccess } from './grants'
import { knowledgeBaseSummary, useKnowledgeBaseOptions } from './knowledge-base-options'
import {
  CreateTokenDialog,
  EditGrantDialog,
  GrantIdentity,
  RevokeGrantDialog,
  TokenCreatedDialog,
} from './personal-token-dialogs'

const NOTICE_CLASS_NAME = 'rounded-lg px-3 py-2.5 system-sm-medium'
const SECTION_TITLE_CLASS_NAME = 'text-[15px]/5 font-semibold text-text-primary'

/** "MCP Connector" in the knowledge list's title bar. */
export function McpConnectorButton() {
  const { t } = useTranslation(['knowledgeSpace'])
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="ghost"
        size="small"
        className="overflow-hidden text-text-tertiary"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden className="i-custom-vender-other-mcp size-3.5 shrink-0" />
        <span className="system-xs-medium">{t(($) => $['agents.button'])}</span>
      </Button>
      <McpConnectorPanel open={open} onOpenChange={setOpen} />
    </>
  )
}

export function McpConnectorPanel({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: tCommon } = useTranslation(['common'])
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<KnowledgeAgentTokenCreatedResponse | null>(null)
  const [editing, setEditing] = useState<KnowledgeAgentGrantResponse | null>(null)
  const [revoking, setRevoking] = useState<KnowledgeAgentGrantResponse | null>(null)
  const mine = useQuery({
    ...consoleQuery.knowledgeFs.agentAccess.get.queryOptions({ meta: { errorToast: false } }),
    enabled: open,
  })
  const knowledgeBases = useKnowledgeBaseOptions(open && mine.data?.available === true)
  const pickerProps = {
    blocked: new Set(mine.data?.blocked_knowledge_base_ids ?? []),
    complete: knowledgeBases.query.isSuccess && !knowledgeBases.query.hasNextPage,
    hasMore: knowledgeBases.query.hasNextPage,
    loadingMore: knowledgeBases.query.isFetchingNextPage,
    onLoadMore: () => void knowledgeBases.query.fetchNextPage(),
    options: knowledgeBases.options,
  }

  return (
    <>
      <Drawer open={open} modal swipeDirection="right" onOpenChange={onOpenChange}>
        <DrawerPortal>
          <DrawerBackdrop />
          <DrawerViewport>
            <DrawerPopup className="data-[swipe-direction=right]:w-full data-[swipe-direction=right]:max-w-150">
              <DrawerContent className="flex h-full flex-col gap-4 overflow-y-auto px-6 pt-5 pb-6">
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <DrawerTitle className="text-base/6 font-semibold text-text-primary">
                    {t(($) => $['agents.title'])}
                  </DrawerTitle>
                  <DrawerClose
                    render={
                      <IconButton
                        variant="ghost"
                        size="md"
                        aria-label={tCommon(($) => $['operation.close'])}
                      >
                        <span aria-hidden className="i-ri-close-line size-3.5" />
                      </IconButton>
                    }
                  />
                </div>
                {mine.isPending ? (
                  <p className={`${NOTICE_CLASS_NAME} bg-background-section text-text-tertiary`}>
                    {t(($) => $['agents.loading'])}
                  </p>
                ) : mine.isError ? (
                  <div className="flex flex-col items-start gap-3">
                    <p role="alert" className="body-sm-regular text-text-destructive">
                      {t(($) => $['agents.loadFailed'])}
                    </p>
                    <Button onClick={() => void mine.refetch()}>
                      {tCommon(($) => $['operation.retry'])}
                    </Button>
                  </div>
                ) : !mine.data.available ? (
                  <p className={`${NOTICE_CLASS_NAME} bg-background-section text-text-tertiary`}>
                    {t(($) => $['agents.unavailable'])}
                  </p>
                ) : (
                  <>
                    {!mine.data.agent_access_enabled && (
                      <p
                        role="status"
                        className={`${NOTICE_CLASS_NAME} bg-state-warning-hover text-text-warning`}
                      >
                        {t(($) => $['agents.workspaceDisabled'])}
                      </p>
                    )}
                    <ConnectSection mcpUrl={mine.data.mcp_url} />
                    <Divider />
                    <section className="flex flex-col gap-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className={SECTION_TITLE_CLASS_NAME}>
                          {t(($) => $['agents.connectionsTitle'])}
                        </h3>
                        <Button
                          size="small"
                          disabled={!mine.data.agent_access_enabled}
                          onClick={() => setCreating(true)}
                        >
                          {t(($) => $['agents.createToken'])}
                        </Button>
                      </div>
                      <MyConnections
                        grants={mine.data.grants}
                        knowledgeBases={knowledgeBases.options}
                        onEdit={setEditing}
                        onRevoke={setRevoking}
                      />
                    </section>
                    <WorkspaceSection
                      ownGrantIds={new Set(mine.data.grants.map((grant) => grant.id))}
                      onRevoke={setRevoking}
                    />
                  </>
                )}
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
      <CreateTokenDialog
        open={creating}
        knowledgeBases={pickerProps}
        onOpenChange={setCreating}
        onCreated={(result) => {
          setCreating(false)
          setCreated(result)
        }}
      />
      <TokenCreatedDialog
        mcpUrl={mine.data?.mcp_url ?? ''}
        result={created}
        onDone={() => setCreated(null)}
      />
      <EditGrantDialog
        grant={editing}
        knowledgeBases={pickerProps}
        onClose={() => setEditing(null)}
      />
      <RevokeGrantDialog grant={revoking} onClose={() => setRevoking(null)} />
    </>
  )
}

function Divider() {
  return <div aria-hidden className="h-px w-full shrink-0 bg-divider-subtle" />
}

function CopyLine({ value }: { value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg bg-background-neutral-subtle py-1.5 ps-3 pe-1.5">
      <code
        className="min-w-0 flex-1 truncate font-mono text-xs/4.5 text-text-primary"
        title={value}
        translate="no"
      >
        {value}
      </code>
      <CopyFeedback content={value} />
    </div>
  )
}

function CommandGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-center gap-1.5 system-sm-medium text-text-primary">
        <AgentIcon name={title} />
        {title}
      </span>
      {children}
    </div>
  )
}

function ConnectSection({ mcpUrl }: { mcpUrl: string }) {
  const { t } = useTranslation(['knowledgeSpace'])
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h3 className={SECTION_TITLE_CLASS_NAME}>{t(($) => $['agents.connectTitle'])}</h3>
        <p className="system-sm-regular text-text-tertiary">
          {t(($) => $['agents.connectDescription'])}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="system-xs-medium text-text-primary">{t(($) => $['agents.mcpUrl'])}</span>
        <CopyLine value={mcpUrl} />
      </div>
      {AGENTS.map(({ id, name, connectCommands, connectHint }) => (
        <CommandGroup key={id} title={name}>
          {connectCommands(mcpUrl).map((command) => (
            <CopyLine key={command} value={command} />
          ))}
          {connectHint && <p className="system-xs-regular text-text-tertiary">{connectHint(t)}</p>}
        </CommandGroup>
      ))}
    </section>
  )
}

function useExpirationLabel() {
  const { t, i18n } = useTranslation(['knowledgeSpace'])
  const locale = i18n.resolvedLanguage ?? i18n.language
  return (value: string | null | undefined) => {
    if (!value) return t(($) => $['agents.never'])
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
  }
}

function MyConnections({
  grants,
  knowledgeBases,
  onEdit,
  onRevoke,
}: {
  grants: KnowledgeAgentGrantResponse[]
  knowledgeBases: readonly KnowledgeBaseOption[]
  onEdit: (grant: KnowledgeAgentGrantResponse) => void
  onRevoke: (grant: KnowledgeAgentGrantResponse) => void
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const expiration = useExpirationLabel()

  if (grants.length === 0)
    return (
      <p className={`${NOTICE_CLASS_NAME} bg-background-neutral-subtle text-text-primary`}>
        {t(($) => $['agents.noConnections'])}
      </p>
    )
  return (
    <table className="block w-full overflow-hidden rounded-lg border border-divider-subtle">
      <thead className="block bg-background-neutral-subtle">
        <tr className="flex h-6.5 items-center gap-3 ps-2.5 pe-2 text-[11px]/4 font-medium text-text-tertiary">
          <th scope="col" className="min-w-0 flex-1 text-start font-medium">
            {t(($) => $['agents.columnConnection'])}
          </th>
          <th scope="col" className="w-27.5 shrink-0 text-start font-medium">
            {t(($) => $['agents.columnExpiration'])}
          </th>
          <th scope="col" className="w-13 shrink-0">
            <span className="sr-only">{t(($) => $['agents.columnActions'])}</span>
          </th>
        </tr>
      </thead>
      <tbody className="block">
        {grants.map((grant) => {
          const { names, more } = knowledgeBaseSummary(grant.knowledge_base_ids, knowledgeBases)
          return (
            <tr key={grant.id} className="flex min-h-13 items-center gap-3 py-1.5 ps-2.5 pe-2">
              <td className="flex min-w-0 flex-1 flex-col gap-0.5">
                <GrantIdentity grant={grant} />
                <span className="truncate ps-7 system-xs-regular text-text-tertiary">
                  {[
                    ...names,
                    ...(more > 0
                      ? [t(($) => $['agents.moreKnowledgeBases'], { number: more })]
                      : []),
                  ].join(', ')}
                </span>
              </td>
              <td className="w-27.5 shrink-0 system-xs-regular text-text-primary">
                {expiration(grant.expires_at)}
              </td>
              <td className="flex w-13 shrink-0 items-center gap-1">
                <IconButton
                  variant="ghost"
                  size="md"
                  aria-label={t(($) => $['agents.editAccess'], { name: grantName(grant) })}
                  onClick={() => onEdit(grant)}
                >
                  <span aria-hidden className="i-ri-edit-line size-4" />
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="md"
                  aria-label={
                    grant.kind === 'personal'
                      ? t(($) => $['agents.deleteNamedToken'], { name: grantName(grant) })
                      : t(($) => $['agents.disconnectNamed'], { name: grantName(grant) })
                  }
                  onClick={() => onRevoke(grant)}
                >
                  <span aria-hidden className="i-ri-delete-bin-line size-4" />
                </IconButton>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function WorkspaceSection({
  onRevoke,
  ownGrantIds,
}: {
  onRevoke: (grant: KnowledgeAgentGrantResponse) => void
  ownGrantIds: ReadonlySet<string>
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const isManager = useAtomValue(isCurrentWorkspaceManagerAtom)
  const switchLabelId = useId()
  const switchHintId = useId()
  const invalidate = useInvalidateAgentAccess()
  const workspace = useQuery({
    ...consoleQuery.knowledgeFs.agentAccess.workspace.get.queryOptions({
      meta: { errorToast: false },
    }),
    enabled: isManager,
  })
  const toggle = useMutation(
    consoleQuery.knowledgeFs.agentAccess.workspace.patch.mutationOptions({
      meta: { errorToast: false },
      onSettled: () => invalidate(),
    }),
  )
  if (!isManager) return null

  return (
    <>
      <Divider />
      <section className="flex flex-col gap-3">
        <h3 className={SECTION_TITLE_CLASS_NAME}>{t(($) => $['agents.workspaceTitle'])}</h3>
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
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span id={switchLabelId} className="system-sm-medium text-text-primary">
                  {t(($) => $['agents.allowAgents'])}
                </span>
                <span id={switchHintId} className="system-xs-regular text-text-tertiary">
                  {t(($) => $['agents.allowAgentsDescription'])}
                </span>
              </span>
              <Switch
                aria-labelledby={switchLabelId}
                aria-describedby={switchHintId}
                checked={
                  toggle.isPending
                    ? (toggle.variables?.body.enabled ?? false)
                    : workspace.data.agent_access_enabled
                }
                disabled={toggle.isPending}
                onCheckedChange={(enabled) => toggle.mutate({ body: { enabled } })}
              />
            </div>
            {toggle.isError && (
              <p role="alert" className="body-xs-regular text-text-destructive">
                {t(($) => $['agents.errorGeneric'])}
              </p>
            )}
            <MemberConnections
              grants={workspace.data.grants.filter((grant) => !ownGrantIds.has(grant.id))}
              onRevoke={onRevoke}
            />
          </>
        )}
      </section>
    </>
  )
}

function MemberConnections({
  grants,
  onRevoke,
}: {
  grants: KnowledgeAgentGrantResponse[]
  onRevoke: (grant: KnowledgeAgentGrantResponse) => void
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const lastUsed = (value: string | null | undefined) => {
    const time = value ? Date.parse(value) : Number.NaN
    return Number.isNaN(time) ? t(($) => $['agents.neverUsed']) : formatTimeFromNow(time)
  }

  return (
    <div className="flex flex-col gap-2">
      <h4 className="system-sm-medium text-text-primary">
        {t(($) => $['agents.membersConnections'])}
      </h4>
      {grants.length === 0 ? (
        <p className="system-xs-regular text-text-tertiary">
          {t(($) => $['agents.noMemberConnections'])}
        </p>
      ) : (
        <table className="block w-full overflow-hidden rounded-lg border border-divider-regular">
          <thead className="block bg-background-neutral-subtle">
            <tr className="flex items-center gap-2 py-1 ps-10 pe-2 system-xs-medium text-text-tertiary">
              <th scope="col" className="min-w-0 flex-1 text-start font-medium">
                {t(($) => $['agents.columnMember'])}
              </th>
              <th scope="col" className="w-22 shrink-0 text-start font-medium">
                {t(($) => $['agents.columnClient'])}
              </th>
              <th scope="col" className="w-28 shrink-0 text-end font-medium">
                {t(($) => $['agents.columnLastUsed'])}
              </th>
              <th scope="col" className="w-6 shrink-0">
                <span className="sr-only">{t(($) => $['agents.columnActions'])}</span>
              </th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-divider-subtle">
            {grants.map((grant) => {
              const member = grant.account ? grant.account.name || grant.account.email : ''
              return (
                <tr key={grant.id} className="flex items-center gap-2 px-2 py-2.5">
                  <td className="flex min-w-0 flex-1 items-center gap-2">
                    <Avatar size="sm" aria-hidden>
                      <AvatarFallback>{member.trim().charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="truncate system-sm-medium text-text-primary" title={member}>
                      {member}
                    </span>
                  </td>
                  <td
                    className="w-22 shrink-0 truncate system-xs-regular text-text-tertiary"
                    title={grantName(grant)}
                  >
                    {grant.kind === 'personal' ? t(($) => $['agents.kindToken']) : grantName(grant)}
                  </td>
                  <td className="w-28 shrink-0 truncate text-end system-xs-regular text-text-tertiary">
                    {lastUsed(grant.last_used_at)}
                  </td>
                  <td className="flex w-6 shrink-0 justify-end">
                    <IconButton
                      variant="ghost"
                      size="md"
                      aria-label={t(($) => $['agents.disconnectNamed'], {
                        name: `${member} · ${grantName(grant)}`,
                      })}
                      onClick={() => onRevoke(grant)}
                    >
                      <span aria-hidden className="i-ri-link-unlink-m size-4" />
                    </IconButton>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
