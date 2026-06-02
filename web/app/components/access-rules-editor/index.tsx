'use client'

import type { AccessPolicyWithBindings, RemoveBindingPayload } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import AccessRuleRow from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import AddRuleTargetsModal from '@/app/components/header/account-setting/access-rules-page/add-rule-targets-modal'
import { useUpdateAppAccessRuleBindings } from '@/service/access-control/use-app-access-config'
import { useUpdateDatasetAccessRuleBindings } from '@/service/access-control/use-dataset-access-config'

export type AccessRulesEditorProps = {
  resourceId: string
  rules: AccessPolicyWithBindings[]
  canManage: boolean
  isLoadingRules?: boolean
  title?: string
  className?: string
}

const AccessRulesEditor = ({
  resourceId,
  rules,
  canManage,
  isLoadingRules = false,
  title,
  className,
}: AccessRulesEditorProps) => {
  const { t } = useTranslation()
  const [currentRule, setCurrentRule] = useState<AccessPolicyWithBindings | null>(null)
  const permissionSetCount = rules.length
  const lockedCount = useMemo(() => {
    let lockedCount = 0
    rules.forEach((rule) => {
      rule.roles.forEach((role) => {
        if (role.is_locked)
          lockedCount += 1
      })
      rule.accounts.forEach((account) => {
        if (account.is_locked)
          lockedCount += 1
      })
    })
    return lockedCount
  }, [rules])
  const currentRuleBindingIds = useMemo(() => {
    if (!currentRule) {
      return {
        initialRoleIds: [] as string[],
        initialMemberIds: [] as string[],
        lockedRoleIds: [] as string[],
        lockedMemberIds: [] as string[],
      }
    }

    const initialRoleIds = currentRule.roles.map(role => role.role_id)
    const initialMemberIds = currentRule.accounts.map(account => account.account_id)
    const lockedRoleIds = currentRule.roles.filter(role => role.is_locked).map(role => role.role_id)
    const lockedMemberIds = currentRule.accounts.filter(account => account.is_locked).map(account => account.account_id)

    return {
      initialRoleIds,
      initialMemberIds,
      lockedRoleIds,
      lockedMemberIds,
    }
  }, [currentRule])

  const handleAddRole = useCallback((rule: AccessPolicyWithBindings) => {
    setCurrentRule(rule)
  }, [])

  const handleCloseAddModal = useCallback(() => {
    setCurrentRule(null)
  }, [])

  const { mutateAsync: updateAppAccessRuleBindings } = useUpdateAppAccessRuleBindings()
  const { mutateAsync: updateDatasetAccessRuleBindings } = useUpdateDatasetAccessRuleBindings()

  const handleAddSubmit = useCallback(
    (selection: { roleIds: string[], memberIds: string[] }) => {
      const { policy } = currentRule || {}
      const { id: policyId, resource_type } = policy || {}
      if (resource_type === 'app') {
        updateAppAccessRuleBindings({
          appId: resourceId,
          policyId: policyId || '',
          role_ids: selection.roleIds,
          account_ids: selection.memberIds,
        }, {
          onSuccess: () => {
            toast.success(t('accessRule.bindingUpdated', { ns: 'permission' }))
          },
        })
      }
      else if (resource_type === 'dataset') {
        updateDatasetAccessRuleBindings({
          datasetId: resourceId,
          policyId: policyId || '',
          role_ids: selection.roleIds,
          account_ids: selection.memberIds,
        }, {
          onSuccess: () => {
            toast.success(t('accessRule.bindingUpdated', { ns: 'permission' }))
          },
        })
      }
    },
    [currentRule, resourceId, t, updateAppAccessRuleBindings, updateDatasetAccessRuleBindings],
  )

  const handleRemoveRole = useCallback(
    (payload: RemoveBindingPayload) => {
      const { policy_id, role_ids, account_ids, resource_type } = payload
      if (resource_type === 'app') {
        updateAppAccessRuleBindings({
          appId: resourceId,
          policyId: policy_id,
          role_ids,
          account_ids,
        }, {
          onSuccess: () => {
            toast.success(t('accessRule.bindingRemoved', { ns: 'permission' }))
          },
        })
      }
      else if (resource_type === 'dataset') {
        updateDatasetAccessRuleBindings({
          datasetId: resourceId,
          policyId: policy_id,
          role_ids,
          account_ids,
        }, {
          onSuccess: () => {
            toast.success(t('accessRule.bindingRemoved', { ns: 'permission' }))
          },
        })
      }
    },
    [resourceId, t, updateAppAccessRuleBindings, updateDatasetAccessRuleBindings],
  )

  return (
    <div className={cn('overflow-hidden rounded-xl border border-components-panel-border bg-components-panel-bg', className)}>
      <div className="flex min-h-12 items-center gap-3 border-b border-divider-deep p-4">
        <h2 className="min-w-0 truncate system-sm-semibold text-text-primary">
          {title}
        </h2>
        <div className="flex shrink-0 items-center gap-1 system-xs-regular text-text-tertiary">
          <span>
            {t('accessRule.summary', { ns: 'permission', count: permissionSetCount })}
          </span>
          {lockedCount > 0 && (
            <span>
              {t('accessRule.lockedSummary', { ns: 'permission', count: lockedCount })}
            </span>
          )}
        </div>
      </div>

      {isLoadingRules
        ? (
            <div className="px-4 py-8 text-center">
              <Loading type="app" />
            </div>
          )
        : rules.length === 0
          ? (
              <div className="px-4 py-8 text-center system-sm-regular text-text-tertiary">
                {t('accessRule.noRules', { ns: 'permission' })}
              </div>
            )
          : (
              <div className="px-4">
                {
                  rules.map((rule, index) => (
                    <AccessRuleRow
                      key={rule.policy.id}
                      rule={rule}
                      canManage={canManage}
                      bindingTarget="resource"
                      showMenu={false}
                      onAddRole={handleAddRole}
                      onRemove={handleRemoveRole}
                      className={cn(index > 0 && 'border-t border-divider-subtle')}
                    />
                  ))
                }
              </div>
            )}

      {currentRule && (
        <AddRuleTargetsModal
          ruleName={currentRule.policy.name}
          initialRoleIds={currentRuleBindingIds.initialRoleIds}
          initialMemberIds={currentRuleBindingIds.initialMemberIds}
          lockedRoleIds={currentRuleBindingIds.lockedRoleIds}
          lockedMemberIds={currentRuleBindingIds.lockedMemberIds}
          onClose={handleCloseAddModal}
          onSubmit={handleAddSubmit}
        />
      )}
    </div>
  )
}

export default AccessRulesEditor
