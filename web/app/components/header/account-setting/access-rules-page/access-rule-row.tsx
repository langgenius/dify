'use client'

import type { AccessPolicyWithBindings } from '@/models/access-control'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRuleRowMenu from './access-rule-row-menu'

type AccessRuleRowProps = {
  rule: AccessPolicyWithBindings
  canManage: boolean
  className?: string
  showMenu?: boolean
  onView?: (rule: AccessPolicyWithBindings) => void
  onEdit?: (rule: AccessPolicyWithBindings) => void
}

const AccessRuleRow = ({
  rule,
  canManage,
  className,
  showMenu = true,
  onView,
  onEdit,
}: AccessRuleRowProps) => {
  const { t } = useTranslation()
  const { policy } = rule
  const description =
    policy.description.trim() || t(($) => $['accessRule.noDescription'], { ns: 'permission' })

  const handleView = useCallback(() => onView?.(rule), [onView, rule])
  const handleEdit = useCallback(() => onEdit?.(rule), [onEdit, rule])

  return (
    <div className={cn('flex items-start gap-3 px-1 py-3.5', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex h-6 items-center system-sm-semibold text-text-primary">
          {policy.name}
        </div>
        <p className="system-xs-regular leading-4 text-text-tertiary">{description}</p>
      </div>
      {showMenu && canManage && (
        <AccessRuleRowMenu onView={handleView} onEdit={handleEdit} rule={policy} />
      )}
    </div>
  )
}

export default memo(AccessRuleRow)
