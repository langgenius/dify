'use client'

import type { AccessPolicyMemberBindingRemoval } from '@/app/components/access-rules-editor'
import { Button } from '@langgenius/dify-ui/button'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import { useLocale } from '@/context/i18n'
import { useAgentPermissions } from '@/features/agent-v2/permissions'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { RESOURCE_ACCESS_SETTINGS_PAGE_SIZE } from '@/service/access-control/constants'
import { consoleQuery } from '@/service/console'

export function AgentAccessConfigPage({ agentId }: { agentId: string }) {
  const { t } = useTranslation()
  const language = getAccessControlTemplateLanguage(useLocale())
  const { agentQuery, canAccessConfig } = useAgentPermissions(agentId)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(RESOURCE_ACCESS_SETTINGS_PAGE_SIZE)
  const [updatingAccountId, setUpdatingAccountId] = useState<string | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)
  const resource = consoleQuery.workspaces.current.rbac.agents.byAgentId
  const params = { agent_id: agentId }
  const rules = useQuery(
    resource.accessPolicy.get.queryOptions({
      input: { params, query: { language } },
      enabled: canAccessConfig,
    }),
  )
  const users = useQuery(
    resource.userAccessPolicies.get.queryOptions({
      input: { params, query: { language, page, limit: pageSize } },
      enabled: canAccessConfig,
      placeholderData: keepPreviousData,
    }),
  )
  const whitelist = useQuery(
    resource.whitelist.get.queryOptions({ input: { params }, enabled: canAccessConfig }),
  )
  const config = useQuery(
    resource.whitelistConfig.get.queryOptions({ input: { params }, enabled: canAccessConfig }),
  )
  const updateScope = useMutation(resource.whitelist.put.mutationOptions())
  const updateUser = useMutation(
    resource.users.byTargetAccountId.accessPolicies.put.mutationOptions(),
  )
  const removeMembers = useMutation(
    resource.accessPolicies.byPolicyId.memberBindings.delete.mutationOptions(),
  )
  const automaticIncludeWorkspaceMembers = updateScope.isPending
    ? updateScope.variables.body.automatic_include_workspace_members
    : config.data?.automatic_include_workspace_members
  const pagination = users.data?.pagination
  const totalPages = pagination?.total_pages ?? 0
  const error = rules.error || users.error || whitelist.error || config.error
  const isBusy = isRemoving || updateScope.isPending || updateUser.isPending
  const canChangeMembership = canAccessConfig && automaticIncludeWorkspaceMembers === false

  const changeUserPolicies = (accountId: string, accessPolicyIds: string[], isAdding = false) => {
    if (!canAccessConfig || isBusy) return
    setUpdatingAccountId(accountId)
    updateUser.mutate(
      {
        params: { ...params, target_account_id: accountId },
        body: { access_policy_ids: accessPolicyIds },
      },
      {
        onSuccess: () => {
          if (isAdding)
            setPage(Math.max(1, Math.ceil(((pagination?.total_count ?? 0) + 1) / pageSize)))
        },
        onSettled: () => setUpdatingAccountId(null),
      },
    )
  }

  const removeBindings = async (removals: AccessPolicyMemberBindingRemoval[]) => {
    if (!canChangeMembership || isBusy) return
    setIsRemoving(true)
    let removedCount = 0
    try {
      // Keep each successful removal visible even if a later policy group fails.
      for (const { accessPolicyId, accountIds } of removals) {
        await removeMembers.mutateAsync({
          params: { ...params, policy_id: accessPolicyId },
          body: { account_ids: accountIds },
        })
        removedCount += accountIds.length
      }
    } finally {
      if (page > 1 && removedCount > 0 && removedCount >= (users.data?.data?.length ?? 0)) {
        setPage((current) => (current === page ? page - 1 : current))
      }
      setIsRemoving(false)
    }
  }

  if (!canAccessConfig) return null

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background-default-subtle">
      <header className="flex min-h-15.5 shrink-0 flex-col justify-center px-6 py-3">
        <h1 className="system-xl-semibold text-text-primary">
          {t(($) => $['settings.resourceAccess'], { ns: 'common' })}
        </h1>
        <p className="mt-0.5 system-sm-regular text-text-tertiary">
          {t(($) => $['accessRule.agentDescription'], { ns: 'permission' })}
        </p>
      </header>
      <main className="flex min-h-0 w-full max-w-240 flex-1 flex-col px-6 pt-8 pb-10 sm:pr-20 sm:pl-12.5">
        {error ? (
          <div role="alert" className="flex items-center justify-center gap-3 py-8">
            <span>{t(($) => $['api.actionFailed'], { ns: 'common' })}</span>
            <Button
              onClick={() => {
                void Promise.all([
                  rules.refetch(),
                  users.refetch(),
                  whitelist.refetch(),
                  config.refetch(),
                ])
              }}
            >
              {t(($) => $['operation.retry'], { ns: 'common' })}
            </Button>
          </div>
        ) : (
          <AccessRulesEditor
            className="min-h-0 w-full flex-1"
            rules={rules.data?.items ?? []}
            userAccessSettings={users.data?.data ?? []}
            isLoadingRules={rules.isPending || whitelist.isPending || config.isPending}
            isLoadingUserAccessSettings={users.isPending}
            automaticIncludeWorkspaceMembers={automaticIncludeWorkspaceMembers}
            isUpdatingAutomaticIncludeWorkspaceMembers={updateScope.isPending}
            existingAccountIds={whitelist.data?.account_ids ?? []}
            currentPage={page}
            pageSize={pageSize}
            totalCount={pagination?.total_count}
            totalPages={totalPages}
            isChangingPage={users.isPlaceholderData || isBusy}
            updatingAccountId={updatingAccountId}
            maintainerId={agentQuery.data?.maintainer}
            onAutomaticIncludeWorkspaceMembersChange={(checked) => {
              if (!canAccessConfig || isBusy || config.isPending) return
              setPage(1)
              updateScope.mutate({ params, body: { automatic_include_workspace_members: checked } })
            }}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPage(1)
              setPageSize(size)
            }}
            onUserAccessPoliciesChange={changeUserPolicies}
            onAddAccessSubject={
              canChangeMembership
                ? (accountId, policies) => {
                    changeUserPolicies(accountId, policies, true)
                  }
                : undefined
            }
            onRemoveAccessPolicyMemberBinding={(accountId, accessPolicyId) => {
              void removeBindings([{ accessPolicyId, accountIds: [accountId] }]).catch(
                () => undefined,
              )
            }}
            onBatchRemoveAccessPolicyMemberBindings={removeBindings}
          />
        )}
      </main>
    </div>
  )
}
