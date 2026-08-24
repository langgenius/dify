'use client'

import type { AccessPolicyWithBindings, ResourceUserAccessSetting } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Pagination } from '@langgenius/dify-ui/pagination'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { RESOURCE_ACCESS_SETTINGS_PAGE_SIZE_OPTIONS } from '@/service/access-control/constants'
import AddAccessSubjectPopover from './add-access-subject-popover'
import AutomaticIncludeWorkspaceMembersSection from './automatic-include-workspace-members-section'
import AccessRulesBatchAction from './batch-action'
import { ACCESS_RULE_TABLE_GRID, DEFAULT_ACCESS_POLICY_ID } from './constants'
import UserAccessPolicyRow from './user-access-policy-row'

export type AccessPolicyMemberBindingRemoval = {
  accessPolicyId: string
  accountIds: string[]
}

export type AccessRulesEditorProps = {
  rules: AccessPolicyWithBindings[]
  userAccessSettings: ResourceUserAccessSetting[]
  isLoadingRules: boolean
  isLoadingUserAccessSettings: boolean
  automaticIncludeWorkspaceMembers?: boolean
  isUpdatingAutomaticIncludeWorkspaceMembers: boolean
  existingAccountIds?: string[]
  currentPage?: number
  pageSize?: number
  totalCount?: number
  totalPages?: number
  isChangingPage?: boolean
  updatingAccountId: string | null
  maintainerId?: string | null
  className?: string
  onAutomaticIncludeWorkspaceMembersChange?: (checked: boolean) => void
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  onUserAccessPoliciesChange?: (accountId: string, accessPolicyIds: string[]) => void
  onRemoveAccessPolicyMemberBinding?: (accountId: string, accessPolicyId: string) => void
  onBatchRemoveAccessPolicyMemberBindings?: (
    removals: AccessPolicyMemberBindingRemoval[],
  ) => Promise<void>
  onAddAccessSubject?: (accountId: string, accessPolicyIds: string[]) => void
}

function AccessRulesEditor({
  rules,
  userAccessSettings,
  isLoadingRules,
  isLoadingUserAccessSettings,
  automaticIncludeWorkspaceMembers,
  isUpdatingAutomaticIncludeWorkspaceMembers,
  existingAccountIds,
  currentPage = 1,
  pageSize,
  totalCount,
  totalPages = 0,
  isChangingPage = false,
  updatingAccountId,
  maintainerId,
  className,
  onAutomaticIncludeWorkspaceMembersChange,
  onPageChange,
  onPageSizeChange,
  onUserAccessPoliciesChange,
  onRemoveAccessPolicyMemberBinding,
  onBatchRemoveAccessPolicyMemberBindings,
  onAddAccessSubject,
}: AccessRulesEditorProps) {
  const { t } = useTranslation()
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(() => new Set())
  const isLoading = isLoadingRules || isLoadingUserAccessSettings
  const shouldCenterTableBody = isLoading || userAccessSettings.length === 0
  const areMembershipChangesDisabled = automaticIncludeWorkspaceMembers === true
  const policyOptions = useMemo(() => {
    return rules.map((rule) => ({
      id: rule.policy.id,
      name: rule.policy.name,
    }))
  }, [rules])
  const selectableAccountIds = useMemo(
    () =>
      userAccessSettings
        .map((setting) => setting.account.account_id)
        .filter((accountId) => accountId !== maintainerId),
    [maintainerId, userAccessSettings],
  )
  const selectedAccountCount = selectableAccountIds.filter((accountId) =>
    selectedAccountIds.has(accountId),
  ).length
  const areAllAccountsSelected =
    selectableAccountIds.length > 0 && selectedAccountCount === selectableAccountIds.length
  const areSomeAccountsSelected = selectedAccountCount > 0 && !areAllAccountsSelected
  const showPagination = totalPages > 0 && !!onPageChange
  const selectedBindingRemovals = useMemo(() => {
    const accountIdsByAccessPolicyId = new Map<string, string[]>()

    for (const setting of userAccessSettings) {
      const accountId = setting.account.account_id
      if (!selectedAccountIds.has(accountId) || accountId === maintainerId) continue

      const accessPolicyId = setting.access_policies[0]?.id ?? DEFAULT_ACCESS_POLICY_ID
      const accountIds = accountIdsByAccessPolicyId.get(accessPolicyId)
      if (accountIds) accountIds.push(accountId)
      else accountIdsByAccessPolicyId.set(accessPolicyId, [accountId])
    }

    return Array.from(accountIdsByAccessPolicyId, ([accessPolicyId, accountIds]) => ({
      accessPolicyId,
      accountIds,
    }))
  }, [maintainerId, selectedAccountIds, userAccessSettings])

  const handleSelectAllAccounts = useCallback(
    (selected: boolean) => {
      setSelectedAccountIds((current) => {
        const next = new Set(current)
        for (const accountId of selectableAccountIds) {
          if (selected) next.add(accountId)
          else next.delete(accountId)
        }
        return next
      })
    },
    [selectableAccountIds],
  )

  const handleAccountSelectedChange = useCallback((accountId: string, selected: boolean) => {
    setSelectedAccountIds((current) => {
      const next = new Set(current)
      if (selected) next.add(accountId)
      else next.delete(accountId)
      return next
    })
  }, [])

  const handleRemoveAccessPolicyMemberBinding = useCallback(
    (accountId: string, accessPolicyId: string) => {
      setSelectedAccountIds((current) => {
        const next = new Set(current)
        next.delete(accountId)
        return next
      })
      onRemoveAccessPolicyMemberBinding?.(accountId, accessPolicyId)
    },
    [onRemoveAccessPolicyMemberBinding],
  )

  const handleAutomaticIncludeWorkspaceMembersChange = useCallback(
    (checked: boolean) => {
      if (checked) setSelectedAccountIds(new Set())

      onAutomaticIncludeWorkspaceMembersChange?.(checked)
    },
    [onAutomaticIncludeWorkspaceMembersChange],
  )

  const handlePageChange = useCallback(
    (page: number) => {
      setSelectedAccountIds(new Set())
      onPageChange?.(page)
    },
    [onPageChange],
  )

  const handlePageSizeChange = useCallback(
    (nextPageSize: number) => {
      setSelectedAccountIds(new Set())
      onPageSizeChange?.(nextPageSize)
    },
    [onPageSizeChange],
  )

  const handleBatchRemoveAccessPolicyMemberBindings = useCallback(async () => {
    if (
      areMembershipChangesDisabled ||
      !onBatchRemoveAccessPolicyMemberBindings ||
      selectedBindingRemovals.length === 0
    )
      return

    await onBatchRemoveAccessPolicyMemberBindings(selectedBindingRemovals)
    setSelectedAccountIds(new Set())
  }, [
    areMembershipChangesDisabled,
    onBatchRemoveAccessPolicyMemberBindings,
    selectedBindingRemovals,
  ])

  return (
    <div className={cn('flex min-h-0 flex-col gap-4 overflow-hidden', className)}>
      <div className="flex min-h-8 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="system-sm-semibold text-text-secondary">
            {t(($) => $['accessRule.allowedMembers'], { ns: 'permission' })}
          </h2>
          <span className="flex min-w-4.5 items-center justify-center rounded-[5px] border border-divider-deep px-1.25 py-0.75 system-2xs-medium-uppercase text-text-tertiary">
            {totalCount ?? 0}
          </span>
        </div>
        {onAddAccessSubject ? (
          <AddAccessSubjectPopover
            disabled={areMembershipChangesDisabled}
            existingAccountIds={existingAccountIds}
            updatingAccountId={updatingAccountId}
            onAddAccessSubject={onAddAccessSubject}
          />
        ) : (
          <Button variant="primary" size="medium" disabled>
            <span className="i-ri-add-line size-3.5" aria-hidden />
            <span>{t(($) => $['operation.add'], { ns: 'common' })}</span>
          </Button>
        )}
      </div>
      <AutomaticIncludeWorkspaceMembersSection
        checked={automaticIncludeWorkspaceMembers}
        loading={isUpdatingAutomaticIncludeWorkspaceMembers}
        onChange={
          onAutomaticIncludeWorkspaceMembersChange
            ? handleAutomaticIncludeWorkspaceMembersChange
            : undefined
        }
      />
      <div className="relative min-h-0 w-full flex-1">
        <section
          aria-busy={isLoading || isChangingPage}
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg"
        >
          <table
            aria-label={t(($) => $['accessRule.allowedMembers'], {
              ns: 'permission',
            })}
            className="flex min-h-0 w-full flex-1 flex-col"
          >
            <thead className="block shrink-0 bg-components-panel-bg">
              <tr
                className={cn(
                  'grid items-center gap-4 border-b border-divider-deep px-4 py-4 system-sm-semibold text-text-tertiary',
                  ACCESS_RULE_TABLE_GRID,
                )}
              >
                <th scope="col" className="font-inherit flex items-center gap-3 text-left">
                  <Checkbox
                    aria-label={t(($) => $['operation.selectAll'], { ns: 'common' })}
                    checked={areAllAccountsSelected}
                    indeterminate={areSomeAccountsSelected}
                    disabled={
                      isChangingPage ||
                      areMembershipChangesDisabled ||
                      !onBatchRemoveAccessPolicyMemberBindings ||
                      selectableAccountIds.length === 0
                    }
                    onCheckedChange={handleSelectAllAccounts}
                  />
                  <span>{t(($) => $['accessRule.collaborator'], { ns: 'permission' })}</span>
                </th>
                <th scope="col" className="font-inherit text-left">
                  {t(($) => $['accessRule.accessPermission'], { ns: 'permission' })}
                </th>
                <th scope="col" className="font-inherit text-left">
                  {t(($) => $['accessRule.actions'], { ns: 'permission' })}
                </th>
              </tr>
            </thead>
            <tbody
              className={cn(
                'block min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-state-accent-solid focus-visible:outline-solid',
                shouldCenterTableBody && 'flex flex-col',
              )}
            >
              {isLoading ? (
                <tr className="flex flex-1">
                  <td
                    colSpan={3}
                    className="flex flex-1 items-center justify-center px-4 py-8 text-center"
                  >
                    <Loading type="app" />
                  </td>
                </tr>
              ) : userAccessSettings.length === 0 ? (
                <tr className="flex flex-1">
                  <td
                    colSpan={3}
                    className="flex flex-1 items-center justify-center px-4 py-8 text-center system-sm-regular text-text-tertiary"
                  >
                    {t(($) => $['accessRule.noUserAccessSettings'], { ns: 'permission' })}
                  </td>
                </tr>
              ) : (
                userAccessSettings.map((setting, index) => (
                  <UserAccessPolicyRow
                    key={setting.account.account_id}
                    setting={setting}
                    policyOptions={policyOptions}
                    disabled={isChangingPage || updatingAccountId === setting.account.account_id}
                    membershipChangesDisabled={areMembershipChangesDisabled}
                    selectionDisabled={!onBatchRemoveAccessPolicyMemberBindings}
                    isMaintainer={maintainerId === setting.account.account_id}
                    selected={selectedAccountIds.has(setting.account.account_id)}
                    className={cn(index > 0 && 'border-t border-divider-subtle')}
                    onSelectedChange={handleAccountSelectedChange}
                    onChange={onUserAccessPoliciesChange}
                    onRemove={handleRemoveAccessPolicyMemberBinding}
                  />
                ))
              )}
            </tbody>
          </table>
          {showPagination ? (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
              className="shrink-0 border-t border-divider-subtle"
              labels={{
                previous: t(($) => $['pagination.previous'], { ns: 'common' }),
                next: t(($) => $['pagination.next'], { ns: 'common' }),
                editPageNumber: (page, pageCount) =>
                  t(($) => $['pagination.editPageNumber'], {
                    ns: 'common',
                    page,
                    totalPages: pageCount,
                  }),
                pageNumberInput: t(($) => $['pagination.pageNumber'], { ns: 'common' }),
              }}
              pageSize={
                pageSize !== undefined && onPageSizeChange
                  ? {
                      value: pageSize,
                      options: RESOURCE_ACCESS_SETTINGS_PAGE_SIZE_OPTIONS,
                      onValueChange: handlePageSizeChange,
                      label: t(($) => $['pagination.perPage'], { ns: 'common' }),
                      ariaLabel: t(($) => $['pagination.perPage'], { ns: 'common' }),
                    }
                  : undefined
              }
            />
          ) : null}
        </section>
        {selectedAccountCount > 0 &&
        !areMembershipChangesDisabled &&
        onBatchRemoveAccessPolicyMemberBindings ? (
          <AccessRulesBatchAction
            className={cn('absolute inset-x-0 z-20', showPagination ? 'bottom-16' : 'bottom-4')}
            selectedCount={selectedAccountCount}
            onDelete={handleBatchRemoveAccessPolicyMemberBindings}
            onCancel={() => setSelectedAccountIds(new Set())}
          />
        ) : null}
      </div>
    </div>
  )
}

export default memo(AccessRulesEditor)
