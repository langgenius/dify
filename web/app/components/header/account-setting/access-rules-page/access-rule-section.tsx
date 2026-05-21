'use client'

import type { AccessPolicyWithBindings, RemoveBindingPayload } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'
import AccessRuleRow from './access-rule-row'

type AccessRuleSectionProps = {
  title: string
  rules: AccessPolicyWithBindings[]
  isLoadingRules: boolean
  onCreate?: () => void
  onEditRule?: (rule: AccessPolicyWithBindings) => void
  onAddRole?: (rule: AccessPolicyWithBindings) => void
  onRemoveBinding?: (payload: RemoveBindingPayload) => void
  className?: string
}

const AccessRuleSection = ({
  title,
  rules,
  isLoadingRules,
  onCreate,
  onEditRule,
  onAddRole,
  onRemoveBinding,
  className,
}: AccessRuleSectionProps) => {
  const workspacePermissionKeys = useAppContextWithSelector(s => s.workspacePermissionKeys)
  const canManage = hasPermission(workspacePermissionKeys, 'workspace.role.manage')

  return (
    <section className={cn('flex flex-col', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="pr-3 system-xs-medium-uppercase tracking-wide text-text-tertiary">
          {title}
        </h3>
        {canManage && (
          <Button
            variant="primary"
            size="medium"
            onClick={onCreate}
            disabled={isLoadingRules}
          >
            <span className="mr-0.5 i-ri-add-line size-4" />
            <span>New permission set</span>
          </Button>
        )}
      </div>
      <div className="overflow-hidden">
        {rules.map((rule, index) => (
          <AccessRuleRow
            key={rule.policy.id}
            rule={rule}
            canManage={canManage}
            className={cn(index > 0 && 'border-t border-divider-subtle')}
            onEdit={onEditRule}
            onAddRole={onAddRole}
            onRemove={onRemoveBinding}
          />
        ))}
      </div>
    </section>
  )
}

export default memo(AccessRuleSection)
