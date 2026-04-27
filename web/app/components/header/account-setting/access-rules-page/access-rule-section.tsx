'use client'

import type { AccessRule, AssignedRole } from './access-rule-row'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import AccessRuleRow from './access-rule-row'

export type AccessRuleSectionProps = {
  title: string
  rules: AccessRule[]
  createButtonLabel: string
  onCreate?: () => void
  onEditRule?: (rule: AccessRule) => void
  onCopyRule?: (rule: AccessRule) => void
  onDeleteRule?: (rule: AccessRule) => void
  onAddRole?: (rule: AccessRule) => void
  onRemoveRole?: (rule: AccessRule, role: AssignedRole) => void
  className?: string
}

const AccessRuleSection = ({
  title,
  rules,
  createButtonLabel,
  onCreate,
  onEditRule,
  onCopyRule,
  onDeleteRule,
  onAddRole,
  onRemoveRole,
  className,
}: AccessRuleSectionProps) => {
  return (
    <section className={cn('flex flex-col', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="pr-3 system-xs-medium-uppercase tracking-wide text-text-tertiary">
          {title}
        </h3>
        <Button variant="secondary" size="medium" onClick={onCreate}>
          {createButtonLabel}
        </Button>
      </div>
      <div className="overflow-hidden">
        {rules.map((rule, index) => (
          <AccessRuleRow
            key={rule.id}
            rule={rule}
            className={cn(index > 0 && 'border-t border-divider-subtle')}
            onEdit={onEditRule}
            onCopy={onCopyRule}
            onDelete={onDeleteRule}
            onAddRole={onAddRole}
            onRemoveRole={onRemoveRole}
          />
        ))}
      </div>
    </section>
  )
}

export default memo(AccessRuleSection)
