'use client'

import type { AccessPolicyWithBindings, BindingType, RemoveBindingPayload } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useCallback } from 'react'
import AccessRuleRowMenu from './access-rule-row-menu'
import RoleTag from './role-tag'

export type AccessRuleRowProps = {
  rule: AccessPolicyWithBindings
  canManage: boolean
  className?: string
  showMenu?: boolean
  onView?: (rule: AccessPolicyWithBindings) => void
  onEdit?: (rule: AccessPolicyWithBindings) => void
  onAddRole?: (rule: AccessPolicyWithBindings) => void
  onRemove?: (payload: RemoveBindingPayload) => void
}

const AccessRuleRow = ({
  rule,
  canManage,
  className,
  showMenu = true,
  onView,
  onEdit,
  onAddRole,
  onRemove,
}: AccessRuleRowProps) => {
  const { policy, roles, accounts } = rule
  const { id: policyId, resource_type } = policy

  const handleView = useCallback(() => onView?.(rule), [onView, rule])
  const handleEdit = useCallback(() => onEdit?.(rule), [onEdit, rule])
  const handleAddRole = useCallback(() => onAddRole?.(rule), [onAddRole, rule])

  const handleRemove = useCallback((id: string, type: BindingType) => {
    if (!onRemove)
      return

    const payload: RemoveBindingPayload = {
      policy_id: policyId,
      resource_type,
      role_ids: roles.map(role => role.role_id),
      account_ids: accounts.map(account => account.account_id),
    }
    if (type === 'role') {
      payload.role_ids = payload.role_ids.filter(roleId => roleId !== id)
    }
    else if (type === 'account') {
      payload.account_ids = payload.account_ids.filter(accountId => accountId !== id)
    }
    onRemove(payload)
  }, [accounts, onRemove, policyId, resource_type, roles])

  return (
    <div className={cn('flex items-start gap-2 py-3.5', className)}>
      <div className="min-w-0 flex-1">
        <div className="system-sm-semibold text-text-secondary">
          {policy.name}
        </div>
        <p className="mt-0.5 system-xs-regular text-text-tertiary">
          {policy.description}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {roles.map(role => (
            <RoleTag
              key={role.role_id}
              id={role.role_id}
              label={role.role_name}
              type="role"
              showRemove={canManage}
              onRemove={handleRemove}
            />
          ))}
          {accounts.map(account => (
            <RoleTag
              key={account.account_id}
              id={account.account_id}
              label={account.account_name}
              type="account"
              showRemove={canManage}
              onRemove={handleRemove}
            />
          ))}
          {canManage && (
            <button
              type="button"
              onClick={handleAddRole}
              className="inline-flex h-6 items-center gap-0.5 rounded-md border border-divider-deep px-1.5 system-xs-medium text-text-tertiary hover:border-divider-solid hover:text-text-secondary"
              aria-label={`Add role to ${policy.name}`}
            >
              <span aria-hidden className="i-ri-add-line h-3 w-3" />
              Add
            </button>
          )}
        </div>
      </div>
      {showMenu && canManage && (
        <AccessRuleRowMenu
          onView={handleView}
          onEdit={handleEdit}
          rule={policy}
        />
      )}
    </div>
  )
}

export default memo(AccessRuleRow)
