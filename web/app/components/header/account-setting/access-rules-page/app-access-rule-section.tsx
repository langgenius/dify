import type { InfiniteData } from '@tanstack/react-query'
import type { PermissionSetFormValues, PermissionSetModalMode } from './permission-set-modal'
import type { AccessPolicyWithBindings, GetAppAccessPoliciesResponse, RemoveBindingPayload } from '@/models/access-control'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import {
  useBindingLock,
  useBindingUnlock,
  useCreateAccessRule,
  useInfiniteWorkspaceAppAccessRules,
  useUpdateAccessRule,
  useUpdateAppAccessRuleBindings,
  workspaceAccessRulesQueryKeys,
} from '@/service/access-control/use-workspace-access-rules'
import AccessRuleSection from './access-rule-section'
import AddRuleTargetsModal from './add-rule-targets-modal'
import PermissionSetModal from './permission-set-modal'
import { getProtectedFullAccessOwnerRoleIds, mergeProtectedRoleIds, updateAccessRulesBindingLockStatus } from './utils'

type AppAccessRuleSectionProps = {
  className?: string
}

type PermissionSetModalState = {
  mode: PermissionSetModalMode
  ruleId?: string
  initialValues?: PermissionSetFormValues
}

const RULES_PER_PAGE = 20

const AppAccessRuleSection = ({
  className,
}: AppAccessRuleSectionProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const [addingRule, setAddingRule] = useState<AccessPolicyWithBindings | null>(null)
  const [permissionSetModalState, setPermissionSetModalState] = useState<PermissionSetModalState | null>(null)
  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])

  const {
    data: appAccessRulesResponse,
    isLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    error,
  } = useInfiniteWorkspaceAppAccessRules({
    page: 1,
    limit: RULES_PER_PAGE,
    language,
  })
  const { mutate: lockBinding } = useBindingLock()
  const { mutate: unlockBinding } = useBindingUnlock()
  const { mutateAsync: createAccessRule } = useCreateAccessRule()
  const { mutateAsync: updateAccessRule } = useUpdateAccessRule()
  const { mutateAsync: updateAppAccessRuleBindings } = useUpdateAppAccessRuleBindings()

  const appAccessRules = appAccessRulesResponse?.pages.flatMap(page => page.items) || []
  const totalCount = appAccessRulesResponse?.pages[0]?.pagination.total_count || 0
  const addingRuleTargetIds = useMemo(() => {
    if (!addingRule) {
      return {
        initialRoleIds: [],
        initialMemberIds: [],
        lockedRoleIds: [],
        lockedMemberIds: [],
        protectedRoleIds: [],
      }
    }

    const protectedRoleIds = getProtectedFullAccessOwnerRoleIds(addingRule)
    return {
      initialRoleIds: addingRule.roles.map(role => role.role_id),
      initialMemberIds: addingRule.accounts.map(account => account.account_id),
      lockedRoleIds: mergeProtectedRoleIds(
        addingRule.roles.filter(role => role.is_locked).map(role => role.role_id),
        protectedRoleIds,
      ),
      lockedMemberIds: addingRule.accounts.filter(account => account.is_locked).map(account => account.account_id),
      protectedRoleIds,
    }
  }, [addingRule])

  const closeAddModal = useCallback(() => {
    setAddingRule(null)
  }, [])

  const closePermissionSetModal = useCallback(() => {
    setPermissionSetModalState(null)
  }, [])

  const handleCreate = useCallback(() => {
    setPermissionSetModalState({ mode: 'create' })
  }, [])

  const handleView = useCallback((rule: AccessPolicyWithBindings) => {
    const { policy } = rule
    setPermissionSetModalState({
      mode: 'view',
      initialValues: {
        name: policy.name,
        description: policy.description,
        permissionKeys: policy.permission_keys,
      },
    })
  }, [])

  const handleEdit = useCallback((rule: AccessPolicyWithBindings) => {
    const { policy } = rule
    setPermissionSetModalState({
      mode: 'edit',
      ruleId: policy.id,
      initialValues: {
        name: policy.name,
        description: policy.description,
        permissionKeys: policy.permission_keys,
      },
    })
  }, [])

  const handleAddRole = useCallback((rule: AccessPolicyWithBindings) => {
    setAddingRule(rule)
  }, [])

  const handleAddSubmit = useCallback((selection: { roleIds: string[], memberIds: string[] }) => {
    if (!addingRule)
      return

    updateAppAccessRuleBindings({
      id: addingRule.policy.id,
      role_ids: mergeProtectedRoleIds(selection.roleIds, addingRuleTargetIds.protectedRoleIds),
      account_ids: selection.memberIds,
    }, {
      onSuccess: () => {
        toast.success(t('accessRule.updated', { ns: 'permission' }))
        closeAddModal()
      },
    })
  }, [addingRule, addingRuleTargetIds.protectedRoleIds, closeAddModal, t, updateAppAccessRuleBindings])

  const handleRemoveBinding = useCallback((payload: RemoveBindingPayload) => {
    updateAppAccessRuleBindings({
      id: payload.policy_id,
      role_ids: payload.role_ids,
      account_ids: payload.account_ids,
    }, {
      onSuccess: () => {
        toast.success(t('accessRule.updated', { ns: 'permission' }))
      },
    })
  }, [t, updateAppAccessRuleBindings])

  const handleToggleLockStatus = useCallback((bindingId: string, newStatus: boolean) => {
    const mutationOptions = {
      onSuccess: () => {
        queryClient.setQueriesData<InfiniteData<GetAppAccessPoliciesResponse>>(
          { queryKey: workspaceAccessRulesQueryKeys.app() },
          data => updateAccessRulesBindingLockStatus(data, bindingId, newStatus),
        )
        toast.success(t('accessRule.updated', { ns: 'permission' }))
      },
    }

    if (newStatus)
      lockBinding(bindingId, mutationOptions)
    else
      unlockBinding(bindingId, mutationOptions)
  }, [lockBinding, queryClient, t, unlockBinding])

  const handlePermissionSetSubmit = useCallback((values: PermissionSetFormValues) => {
    if (!permissionSetModalState)
      return

    const { name, description, permissionKeys } = values
    if (permissionSetModalState.mode === 'create') {
      createAccessRule({
        name,
        description,
        permission_keys: permissionKeys,
        resourceType: 'app',
      }, {
        onSuccess: () => {
          toast.success(t('accessRule.created', { ns: 'permission' }))
          closePermissionSetModal()
        },
      })
    }
    else if (permissionSetModalState.mode === 'edit') {
      updateAccessRule({
        id: permissionSetModalState.ruleId!,
        name,
        description,
        permission_keys: permissionKeys,
        resourceType: 'app',
      }, {
        onSuccess: () => {
          toast.success(t('accessRule.updated', { ns: 'permission' }))
          closePermissionSetModal()
        },
      })
    }
  }, [closePermissionSetModal, createAccessRule, permissionSetModalState, t, updateAccessRule])

  return (
    <>
      <AccessRuleSection
        title={t('accessRule.appTitle', { ns: 'permission' })}
        rules={appAccessRules}
        totalCount={totalCount}
        isLoadingRules={isLoading}
        isFetchingNextPage={isFetchingNextPage}
        hasNextPage={hasNextPage}
        fetchNextPage={fetchNextPage}
        error={error}
        defaultExpanded
        onCreate={handleCreate}
        onViewRule={handleView}
        onEditRule={handleEdit}
        onAddRole={handleAddRole}
        onRemoveBinding={handleRemoveBinding}
        onToggleLockStatus={handleToggleLockStatus}
        className={className}
      />
      {addingRule && (
        <AddRuleTargetsModal
          ruleName={addingRule.policy.name}
          initialRoleIds={addingRuleTargetIds.initialRoleIds}
          initialMemberIds={addingRuleTargetIds.initialMemberIds}
          lockedRoleIds={addingRuleTargetIds.lockedRoleIds}
          lockedMemberIds={addingRuleTargetIds.lockedMemberIds}
          onClose={closeAddModal}
          onSubmit={handleAddSubmit}
        />
      )}
      {permissionSetModalState && (
        <PermissionSetModal
          open
          mode={permissionSetModalState.mode}
          resourceType="app"
          initialValues={permissionSetModalState.initialValues}
          onClose={closePermissionSetModal}
          onSubmit={handlePermissionSetSubmit}
        />
      )}
    </>
  )
}

export default AppAccessRuleSection
