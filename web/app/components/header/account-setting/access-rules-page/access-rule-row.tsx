'use client'

import type { AccessPolicyWithBindings, BindingType, RemoveBindingPayload } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRuleRowMenu from './access-rule-row-menu'
import RoleTag from './role-tag'
import { isProtectedFullAccessOwnerRole } from './utils'

export type AccessRuleRowProps = {
  rule: AccessPolicyWithBindings
  canManage: boolean
  className?: string
  bindingTarget?: 'workspace' | 'resource'
  showMenu?: boolean
  onView?: (rule: AccessPolicyWithBindings) => void
  onEdit?: (rule: AccessPolicyWithBindings) => void
  onAddRole?: (rule: AccessPolicyWithBindings) => void
  onRemove?: (payload: RemoveBindingPayload) => void
  onToggleLockStatus?: (bindingId: string, newStatus: boolean) => void
}

const AccessRuleRow = ({
  rule,
  canManage,
  className,
  bindingTarget = 'workspace',
  showMenu = true,
  onView,
  onEdit,
  onAddRole,
  onRemove,
  onToggleLockStatus,
}: AccessRuleRowProps) => {
  const { t } = useTranslation()
  const { policy, roles, accounts } = rule
  const { id: policyId, resource_type } = policy
  const isWorkspaceBinding = bindingTarget === 'workspace'

  const handleView = useCallback(() => onView?.(rule), [onView, rule])
  const handleEdit = useCallback(() => onEdit?.(rule), [onEdit, rule])
  const handleAddRole = useCallback(() => onAddRole?.(rule), [onAddRole, rule])
  const handleToggleLockStatus = useCallback((bindingId: string, newStatus: boolean) => {
    onToggleLockStatus?.(bindingId, newStatus)
  }, [onToggleLockStatus])

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
    <div className={cn('flex items-start gap-3 px-1 py-3.5', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center system-sm-semibold text-text-primary">
          {policy.name}
        </div>
        <p className="system-xs-regular leading-4 text-text-tertiary">
          {policy.description}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {roles.map((role) => {
            const isLockedOwner = isProtectedFullAccessOwnerRole(policy.policy_key, role)
            return (
              <RoleTag
                key={role.role_id}
                id={role.role_id}
                bindingId={role.binding_id}
                label={role.role_name}
                type="role"
                isLocked={role.is_locked}
                canChangeLockStatus={isWorkspaceBinding && canManage && !!onToggleLockStatus && !isLockedOwner}
                onToggleLockStatus={handleToggleLockStatus}
                showRemove={canManage && !isLockedOwner}
                onRemove={handleRemove}
              />
            )
          })}
          {accounts.map(account => (
            <RoleTag
              key={account.account_id}
              id={account.account_id}
              bindingId={account.binding_id}
              label={account.account_name}
              type="account"
              avatar={account.avatar}
              isLocked={account.is_locked}
              canChangeLockStatus={isWorkspaceBinding && canManage && !!onToggleLockStatus}
              onToggleLockStatus={handleToggleLockStatus}
              showRemove={canManage}
              onRemove={handleRemove}
            />
          ))}
          {canManage && (
            <button
              type="button"
              onClick={handleAddRole}
              className="inline-flex h-6 items-center gap-1 rounded-full border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg p-1 pr-2 system-xs-medium text-components-button-secondary-text transition-colors outline-none hover:bg-components-button-secondary-bg-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              aria-label={t('accessRule.addRoleAria', { ns: 'permission', name: policy.name })}
            >
              <span aria-hidden className="i-ri-add-line size-3.5 shrink-0 text-text-tertiary" />
              {t('operation.add', { ns: 'common' })}
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
