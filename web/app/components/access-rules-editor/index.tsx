'use client'

import type { AccessPolicyWithBindings, RemoveBindingPayload } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRuleRow from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import AddRuleTargetsModal from '@/app/components/header/account-setting/access-rules-page/add-rule-targets-modal'
import { useUpdateAppAccessRuleBindings } from '@/service/access-control/use-app-access-config'
import { useUpdateDatasetAccessRuleBindings } from '@/service/access-control/use-dataset-access-config'

export type AccessRulesEditorProps = {
  resourceId: string
  rules: AccessPolicyWithBindings[]
  canManage: boolean
  className?: string
}

const AccessRulesEditor = ({
  resourceId,
  rules,
  canManage,
  className,
}: AccessRulesEditorProps) => {
  const { t } = useTranslation()
  const [currentRule, setCurrentRule] = useState<AccessPolicyWithBindings | null>(null)

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
    <div className={cn('flex flex-col', className)}>
      {rules.map((rule, index) => (
        <AccessRuleRow
          key={rule.policy.id}
          rule={rule}
          canManage={canManage}
          showMenu={false}
          onAddRole={handleAddRole}
          onRemove={handleRemoveRole}
          className={cn(index > 0 && 'border-t border-divider-subtle')}
        />
      ))}

      {currentRule && (
        <AddRuleTargetsModal
          ruleName={currentRule.policy.name}
          initialRoleIds={currentRule.roles.map(role => role.role_id)}
          initialMemberIds={currentRule.accounts.map(account => account.account_id)}
          onClose={handleCloseAddModal}
          onSubmit={handleAddSubmit}
        />
      )}
    </div>
  )
}

export default AccessRulesEditor
