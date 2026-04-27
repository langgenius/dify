'use client'

import { cn } from '@langgenius/dify-ui/cn'
import { memo, useCallback } from 'react'
import AccessRuleRowMenu from './access-rule-row-menu'
import RoleTag from './role-tag'

export type AssignedRole = {
  id: string
  name: string
}

export type AccessRule = {
  id: string
  name: string
  description: string
  assignedRoles: AssignedRole[]
  permissions: string[]
}

export type AccessRuleRowProps = {
  rule: AccessRule
  className?: string
  showMenu?: boolean
  onEdit?: (rule: AccessRule) => void
  onCopy?: (rule: AccessRule) => void
  onDelete?: (rule: AccessRule) => void
  onAddRole?: (rule: AccessRule) => void
  onRemoveRole?: (rule: AccessRule, role: AssignedRole) => void
}

const AccessRuleRow = ({
  rule,
  className,
  showMenu = true,
  onEdit,
  onCopy,
  onDelete,
  onAddRole,
  onRemoveRole,
}: AccessRuleRowProps) => {
  const handleEdit = useCallback(() => onEdit?.(rule), [onEdit, rule])
  const handleCopy = useCallback(() => onCopy?.(rule), [onCopy, rule])
  const handleDelete = useCallback(() => onDelete?.(rule), [onDelete, rule])
  const handleAddRole = useCallback(() => onAddRole?.(rule), [onAddRole, rule])

  return (
    <div className={cn('flex items-start gap-2 py-3.5', className)}>
      <div className="min-w-0 flex-1">
        <div className="system-sm-semibold text-text-secondary">
          {rule.name}
        </div>
        <p className="mt-0.5 system-xs-regular text-text-tertiary">
          {rule.description}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {rule.assignedRoles.map(role => (
            <RoleTag
              key={role.id}
              label={role.name}
              onRemove={onRemoveRole ? () => onRemoveRole(rule, role) : undefined}
            />
          ))}
          <button
            type="button"
            onClick={handleAddRole}
            className="inline-flex h-6 items-center gap-0.5 rounded-md border border-divider-deep px-1.5 system-xs-medium text-text-tertiary hover:border-divider-solid hover:text-text-secondary"
            aria-label={`Add role to ${rule.name}`}
          >
            <span aria-hidden className="i-ri-add-line h-3 w-3" />
            Add
          </button>
        </div>
      </div>
      {showMenu && (
        <AccessRuleRowMenu
          onEdit={handleEdit}
          onCopy={handleCopy}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}

export default memo(AccessRuleRow)
