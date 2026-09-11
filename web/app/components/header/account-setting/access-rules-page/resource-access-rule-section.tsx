'use client'

import type { PermissionSetFormValues, PermissionSetModalMode } from './permission-set-modal'
import type { AccessRule } from './types'
import type { AccessPolicyResourceType } from '@/models/access-control'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
import AccessRuleSection from './access-rule-section'
import PermissionSetModal from './permission-set-modal'

const resourceQueries = {
  app: consoleQuery.workspaces.current.rbac.workspace.apps.accessPolicy.get,
  dataset: consoleQuery.workspaces.current.rbac.workspace.datasets.accessPolicy.get,
  agent: consoleQuery.workspaces.current.rbac.workspace.agents.accessPolicy.get,
}

export function ResourceAccessRuleSection({
  resourceType,
}: {
  resourceType: AccessPolicyResourceType
}) {
  const { t } = useTranslation('permission')
  const language = getAccessControlTemplateLanguage(useLocale())
  const canManage = hasPermission(
    useAtomValue(workspacePermissionKeysAtom),
    'workspace.role.manage',
  )
  const [modal, setModal] = useState<{ mode: PermissionSetModalMode; rule?: AccessRule } | null>(
    null,
  )
  const rulesQuery = useInfiniteQuery(
    resourceQueries[resourceType].infiniteOptions({
      input: (page) => ({ query: { language, page, limit: 20 } }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) => {
        const page = lastPage.pagination?.current_page ?? 1
        return page < (lastPage.pagination?.total_pages ?? 0) ? page + 1 : undefined
      },
    }),
  )
  const createRule = useMutation(
    consoleQuery.workspaces.current.rbac.accessPolicies.post.mutationOptions(),
  )
  const updateRule = useMutation(
    consoleQuery.workspaces.current.rbac.accessPolicies.byPolicyId.put.mutationOptions(),
  )
  const rules = (rulesQuery.data?.pages.flatMap((page) => page.items ?? []) ?? []).flatMap(
    (rule) => (rule.policy ? [{ ...rule, policy: rule.policy }] : []),
  )

  const submit = async ({ name, description, permissionKeys }: PermissionSetFormValues) => {
    if (!canManage || !modal || modal.mode === 'view') return
    const body = { name, description, permission_keys: permissionKeys }
    if (modal.mode === 'create') {
      await createRule.mutateAsync({ body: { ...body, resource_type: resourceType } })
      toast.success(t(($) => $['accessRule.created']))
    } else if (modal.rule) {
      await updateRule.mutateAsync({ params: { policy_id: modal.rule.policy.id }, body })
      toast.success(t(($) => $['accessRule.updated']))
    }
  }

  return (
    <>
      <AccessRuleSection
        title={t(($) => $[`accessRule.${resourceType}Title`])}
        rules={rules}
        totalCount={rulesQuery.data?.pages[0]?.pagination?.total_count}
        isLoadingRules={rulesQuery.isPending}
        isFetchingNextPage={rulesQuery.isFetchingNextPage}
        hasNextPage={rulesQuery.hasNextPage}
        fetchNextPage={() => void rulesQuery.fetchNextPage()}
        error={rulesQuery.error}
        onRetry={() => void rulesQuery.refetch()}
        defaultExpanded={resourceType === 'app'}
        onCreate={() => setModal({ mode: 'create' })}
        onViewRule={(rule) => setModal({ mode: 'view', rule })}
        onEditRule={(rule) => setModal({ mode: 'edit', rule })}
      />
      {modal && (modal.mode === 'view' || canManage) && (
        <PermissionSetModal
          open
          mode={modal.mode}
          resourceType={resourceType}
          initialValues={
            modal.rule
              ? {
                  name: modal.rule.policy.name,
                  description: modal.rule.policy.description ?? '',
                  permissionKeys: modal.rule.policy.permission_keys ?? [],
                }
              : undefined
          }
          onClose={() => setModal(null)}
          onSubmit={submit}
        />
      )}
    </>
  )
}
