'use client'

import type {
  AccessRule,
  AssignedRole,
} from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useCallback, useState } from 'react'
import AccessRuleRow from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import AddRuleTargetsModal from '@/app/components/header/account-setting/access-rules-page/add-rule-targets-modal'

export type AccessConfigModalProps = {
  open: boolean
  title: string
  description: string
  initialRules: AccessRule[]
  /**
   * Optional override label for the primary action. Defaults to "Save".
   */
  saveLabel?: string
  /**
   * Optional override label for the cancel action. Defaults to "Cancel".
   */
  cancelLabel?: string
  onClose: () => void
  onSave?: (rules: AccessRule[]) => void
}

type AccessConfigModalBodyProps = Omit<AccessConfigModalProps, 'open'>

const AccessConfigModalBody = ({
  title,
  description,
  initialRules,
  saveLabel = 'Save',
  cancelLabel = 'Cancel',
  onClose,
  onSave,
}: AccessConfigModalBodyProps) => {
  const [rules, setRules] = useState<AccessRule[]>(initialRules)
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
      setRules(prev =>
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
    [],
  )

  const handleSave = useCallback(() => {
    onSave?.(rules)
    onClose()
  }, [onClose, onSave, rules])

  return (
    <DialogContent
      className="flex max-h-[85vh] w-[520px] flex-col overflow-hidden p-0"
      backdropProps={{ forceRender: true }}
    >
      <div className="relative shrink-0 px-6 pt-6 pb-4">
        <DialogCloseButton />
        <div className="pr-8">
          <DialogTitle className="system-xl-semibold text-text-primary">
            {title}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {description}
          </DialogDescription>
        </div>
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        slotClassNames={{ viewport: 'px-6 overscroll-contain' }}
      >
        <div className="flex flex-col">
          {rules.map(rule => (
            <AccessRuleRow
              key={rule.id}
              rule={rule}
              showMenu={false}
              onAddRole={handleAddRole}
              onRemoveRole={handleRemoveRole}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-divider-subtle px-6 py-4">
        <Button variant="secondary" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button variant="primary" onClick={handleSave}>
          {saveLabel}
        </Button>
      </div>

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
    </DialogContent>
  )
}

const AccessConfigModal = ({
  open,
  title,
  description,
  initialRules,
  saveLabel,
  cancelLabel,
  onClose,
  onSave,
}: AccessConfigModalProps) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <AccessConfigModalBody
        title={title}
        description={description}
        initialRules={initialRules}
        saveLabel={saveLabel}
        cancelLabel={cancelLabel}
        onClose={onClose}
        onSave={onSave}
      />
    </Dialog>
  )
}

export default AccessConfigModal
