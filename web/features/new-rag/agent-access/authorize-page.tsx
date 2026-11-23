'use client'

import { Button, buttonVariants } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { isUnauthorizedError } from '@/service/http-error'
import { agentAccessErrorCode, rejectedKnowledgeBaseIds } from './agent-access'
import { useKnowledgeBaseOptions } from './knowledge-base-options'
import { KnowledgeBasePicker } from './knowledge-base-picker'

export const KNOWLEDGE_AGENT_AUTHORIZE_PATH = '/account/knowledge-agent/authorize'

const AUTHORIZATION_PARAMS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const

type AuthorizationParams = Partial<Record<(typeof AUTHORIZATION_PARAMS)[number], string>>

const NOTICE_CLASS_NAME = 'rounded-lg px-3 py-2 body-xs-regular'

/**
 * OAuth consent for a personal agent (Claude Code, Codex, any MCP client). The agent opened this
 * page; approving sends the browser back to the agent with a one-time code for the chosen bases.
 */
export function KnowledgeAgentAuthorizePage() {
  const { t } = useTranslation(['knowledgeSpace', 'oauth'])
  useDocumentTitle(t(($) => $['agents.authorizeTitle']))
  const searchParams = useSearchParams()
  const params: AuthorizationParams = {}
  for (const key of AUTHORIZATION_PARAMS) {
    const value = searchParams.get(key)
    if (value !== null) params[key] = value
  }
  const profile = useQuery({
    ...userProfileQueryOptions(),
    throwOnError: (error) => !isUnauthorizedError(error),
  })
  const isLoggedIn = Boolean(profile.data) && !profile.error
  const request = useQuery({
    ...consoleQuery.knowledgeFs.agentAccess.authorize.get.queryOptions({
      input: { query: params },
      context: { silent: true },
    }),
    enabled: isLoggedIn,
    retry: false,
  })
  const workspaces = useQuery({
    ...consoleQuery.workspaces.get.queryOptions({ context: { silent: true } }),
    enabled: isLoggedIn,
  })
  const knowledgeBases = useKnowledgeBaseOptions(request.isSuccess)
  const [selected, setSelected] = useState<string[]>([])
  const switchWorkspace = useMutation(
    consoleQuery.workspaces.switch.post.mutationOptions({
      context: { silent: true },
      onSuccess: () => window.location.reload(),
    }),
  )
  const decide = useMutation(
    consoleQuery.knowledgeFs.agentAccess.authorize.post.mutationOptions({
      context: { silent: true },
      onSuccess: ({ redirect_to }) => window.location.assign(redirect_to),
    }),
  )

  if (profile.isPending || (isLoggedIn && request.isPending)) {
    return <LoadingPlaceholder className="h-full" />
  }

  if (!isLoggedIn) {
    const returnUrl = `${KNOWLEDGE_AGENT_AUTHORIZE_PATH}?${searchParams.toString()}`
    return (
      <div className="flex flex-col gap-4">
        <h1 className="title-4xl-semi-bold text-text-primary">
          {t(($) => $['agents.authorizeTitle'])}
        </h1>
        <p className="body-md-regular text-text-secondary">
          {t(($) => $['tips.needLogin'], { ns: 'oauth' })}
        </p>
        <Link
          href={`/signin?redirect_url=${encodeURIComponent(returnUrl)}`}
          className={cn(buttonVariants({ variant: 'primary', size: 'large' }), 'w-full')}
        >
          {t(($) => $.login, { ns: 'oauth' })}
        </Link>
      </div>
    )
  }

  if (request.isError || !request.data) {
    const code = agentAccessErrorCode(request.error)
    return (
      <div className="flex flex-col gap-3">
        <h1 className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['agents.authorizeInvalidTitle'])}
        </h1>
        <p role="alert" className="body-md-regular text-text-secondary">
          {code === 'agent_access_unavailable' || code === undefined
            ? t(($) => $['agents.unavailable'])
            : t(($) => $['agents.authorizeInvalid'])}
        </p>
        {code && <p className="system-xs-regular text-text-tertiary">{code}</p>}
      </div>
    )
  }

  const described = request.data
  const blocked = new Set(described.blocked_knowledge_base_ids)
  const workspaceList = workspaces.data?.workspaces ?? []
  const rejected = rejectedKnowledgeBaseIds(decide.error)
  const rejectedNames = rejected
    .map((id) => knowledgeBases.options.find((option) => option.id === id)?.name ?? id)
    .join(', ')
  const decideCode = agentAccessErrorCode(decide.error)
  const submit = (approve: boolean) =>
    decide.mutate({ body: { ...params, approve, knowledge_base_ids: approve ? selected : [] } })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="title-4xl-semi-bold">
          <span className="block text-text-primary">{t(($) => $.connect, { ns: 'oauth' })}</span>
          <span className="block wrap-break-word text-saas-dify-blue-inverted">
            {described.client.name}
          </span>
        </h1>
        <p className="body-md-regular text-text-secondary">
          {t(($) => $['agents.authorizeDescription'], {
            client: described.client.name,
            host: described.client.redirect_host,
          })}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="system-sm-medium text-text-secondary">
          {t(($) => $['agents.workspace'])}
        </span>
        {workspaceList.length > 1 ? (
          <Select
            value={described.workspace.id}
            onValueChange={(value) =>
              value &&
              value !== described.workspace.id &&
              switchWorkspace.mutate({ body: { tenant_id: value } })
            }
          >
            <SelectTrigger
              aria-label={t(($) => $['agents.workspace'])}
              disabled={switchWorkspace.isPending}
            >
              {described.workspace.name}
            </SelectTrigger>
            <SelectContent>
              {workspaceList.map((workspace) => (
                <SelectItem key={workspace.id} value={workspace.id}>
                  <SelectItemText>{workspace.name ?? workspace.id}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="rounded-lg bg-background-section-burn-inverted px-3 py-2 system-sm-medium text-text-secondary">
            {described.workspace.name}
          </p>
        )}
      </div>

      {!described.agent_access_enabled ? (
        <p role="alert" className={`${NOTICE_CLASS_NAME} bg-state-warning-hover text-text-warning`}>
          {t(($) => $['agents.workspaceDisabled'])}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2 rounded-xl bg-background-section-burn-inverted px-4 py-3 body-sm-medium text-text-secondary">
            <li className="flex items-center gap-2">
              <span aria-hidden className="i-ri-book-open-line size-4 shrink-0" />
              {t(($) => $['agents.permissionRead'])}
            </li>
            <li className="flex items-center gap-2">
              <span aria-hidden className="i-ri-forbid-line size-4 shrink-0" />
              {t(($) => $['agents.permissionNoWrite'])}
            </li>
          </ul>
          <div className="flex flex-col gap-1">
            <span className="system-sm-medium text-text-secondary">
              {t(($) => $['agents.chooseKnowledgeBases'])}
            </span>
            {knowledgeBases.query.isPending ? (
              <LoadingPlaceholder className="h-16" />
            ) : (
              <KnowledgeBasePicker
                blocked={blocked}
                disabled={decide.isPending}
                hasMore={knowledgeBases.query.hasNextPage}
                loadingMore={knowledgeBases.query.isFetchingNextPage}
                onLoadMore={() => void knowledgeBases.query.fetchNextPage()}
                options={knowledgeBases.options}
                value={selected}
                onChange={setSelected}
              />
            )}
          </div>
        </>
      )}

      {decide.isError && (
        <p role="alert" className="body-xs-regular text-text-destructive">
          {decideCode === 'knowledge_base_agent_access_blocked'
            ? t(($) => $['agents.errorBlocked'], { names: rejectedNames })
            : decideCode === 'invalid_knowledge_bases'
              ? t(($) => $['agents.errorKnowledgeBases'], { names: rejectedNames })
              : t(($) => $['agents.errorGeneric'])}
        </p>
      )}

      <div className="flex flex-col gap-2 pt-1">
        <Button
          variant="primary"
          size="large"
          className="w-full"
          loading={decide.isPending && decide.variables?.body.approve === true}
          disabled={!described.agent_access_enabled || selected.length === 0 || decide.isPending}
          onClick={() => submit(true)}
        >
          {t(($) => $['agents.allow'])}
        </Button>
        <Button
          size="large"
          className="w-full"
          loading={decide.isPending && decide.variables?.body.approve === false}
          disabled={decide.isPending}
          onClick={() => submit(false)}
        >
          {t(($) => $['agents.deny'])}
        </Button>
      </div>
      <p className="system-xs-regular text-text-tertiary">
        {t(($) => $['agents.authorizeFootnote'])}
      </p>
    </div>
  )
}
