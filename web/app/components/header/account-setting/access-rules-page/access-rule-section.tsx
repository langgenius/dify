'use client'

import type { AccessPolicyWithBindings, RemoveBindingPayload } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { memo, useCallback } from 'react'
import {
  useUpdateAppAccessRuleBindings,
  useUpdateDatasetAccessRuleBindings,
} from '@/service/access-control/use-workspace-access-rules'
import AccessRuleRow from './access-rule-row'

type AccessRuleSectionProps = {
  title: string
  rules: AccessPolicyWithBindings[]
  isLoadingRules: boolean
  createButtonLabel: string
  onCreate?: () => void
  onEditRule?: (rule: AccessPolicyWithBindings) => void
  onAddRole?: (rule: AccessPolicyWithBindings) => void
  className?: string
}

const AccessRuleSection = ({
  title,
  rules,
  isLoadingRules,
  createButtonLabel,
  onCreate,
  onEditRule,
  onAddRole,
  className,
}: AccessRuleSectionProps) => {
  const { mutateAsync: updateAppAccessRuleBindings } = useUpdateAppAccessRuleBindings()
  const { mutateAsync: updateDatasetAccessRuleBindings } = useUpdateDatasetAccessRuleBindings()

  const handleRemoveRole = useCallback((payload: RemoveBindingPayload) => {
    const { policy_id, resource_type, role_ids, account_ids } = payload
    const updatePayload = {
      id: policy_id,
      role_ids,
      account_ids,
    }
    if (resource_type === 'app') {
      updateAppAccessRuleBindings(updatePayload, {
        onSuccess: () => {
          toast.success('Access rule updated successfully')
        },
      })
    }
    else if (resource_type === 'dataset') {
      updateDatasetAccessRuleBindings(updatePayload, {
        onSuccess: () => {
          toast.success('Access rule updated successfully')
        },
      })
    }
  }, [updateAppAccessRuleBindings, updateDatasetAccessRuleBindings])

  return (
    <section className={cn('flex flex-col', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="pr-3 system-xs-medium-uppercase tracking-wide text-text-tertiary">
          {title}
        </h3>
        <Button
          variant="secondary"
          size="medium"
          onClick={onCreate}
          disabled={isLoadingRules}
        >
          {createButtonLabel}
        </Button>
      </div>
      <div className="overflow-hidden">
        {rules.map((rule, index) => (
          <AccessRuleRow
            key={rule.policy.id}
            rule={rule}
            className={cn(index > 0 && 'border-t border-divider-subtle')}
            onEdit={onEditRule}
            onAddRole={onAddRole}
            onRemove={handleRemoveRole}
          />
        ))}
      </div>
    </section>
  )
}

export default memo(AccessRuleSection)
