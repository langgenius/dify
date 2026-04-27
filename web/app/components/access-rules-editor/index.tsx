'use client'

import type {
  AccessRule,
  AssignedRole,
} from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useState } from 'react'
import AccessRuleRow from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import AddRuleTargetsModal from '@/app/components/header/account-setting/access-rules-page/add-rule-targets-modal'

export type AccessRulesEditorProps = {
  rules: AccessRule[]
  /**
   * Called whenever assigned roles/members are mutated. The editor is
   * controlled when this callback is provided, uncontrolled (with internal
   * state seeded from `rules`) otherwise.
   */
  onRulesChange?: (rules: AccessRule[]) => void
  className?: string
}

const AccessRulesEditor = ({
  rules: rulesProp,
  onRulesChange,
  className,
}: AccessRulesEditorProps) => {
  const isControlled = typeof onRulesChange === 'function'
  const [internalRules, setInternalRules] = useState<AccessRule[]>(rulesProp)
  const rules = isControlled ? rulesProp : internalRules

  const updateRules = useCallback(
    (updater: (prev: AccessRule[]) => AccessRule[]) => {
      if (isControlled) {
        onRulesChange(updater(rulesProp))
        return
      }
      setInternalRules(prev => updater(prev))
    },
    [isControlled, onRulesChange, rulesProp],
  )

  const [addingRule, setAddingRule] = useState<AccessRule | null>(null)

  const handleAddRole = useCallback((rule: AccessRule) => {
    setAddingRule(rule)
  }, [])

  const handleCloseAddModal = useCallback(() => {
    setAddingRule(null)
  }, [])

  const handleAddSubmit = useCallback(
    (_selection: { roleIds: string[], memberIds: string[] }) => {
      // TODO: wire up to API when backend is ready.
    },
    [],
  )

  const handleRemoveRole = useCallback(
    (target: AccessRule, role: AssignedRole) => {
      updateRules(prev =>
        prev.map(rule =>
          rule.id === target.id
            ? {
                ...rule,
                assignedRoles: rule.assignedRoles.filter(r => r.id !== role.id),
              }
            : rule,
        ),
      )
    },
    [updateRules],
  )

  return (
    <div className={cn('flex flex-col', className)}>
      {rules.map((rule, index) => (
        <AccessRuleRow
          key={rule.id}
          rule={rule}
          showMenu={false}
          onAddRole={handleAddRole}
          onRemoveRole={handleRemoveRole}
          className={cn(index > 0 && 'border-t border-divider-subtle')}
        />
      ))}

      {addingRule && (
        <AddRuleTargetsModal
          open
          ruleName={addingRule.name}
          initialRoleIds={addingRule.assignedRoles.map(role => role.id)}
          initialMemberIds={[]}
          onClose={handleCloseAddModal}
          onSubmit={handleAddSubmit}
        />
      )}
    </div>
  )
}

export default AccessRulesEditor
