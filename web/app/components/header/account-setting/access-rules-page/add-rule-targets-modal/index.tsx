'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RolesTab from '../../workspace-role-checkbox-list'
import MembersTab from './members-tab'

type TabKey = 'roles' | 'members'

type AddRuleTargetsModalBaseProps = {
  ruleName?: string
  initialRoleIds?: string[]
  initialMemberIds?: string[]
  onClose: () => void
  onSubmit: (selection: { roleIds: string[], memberIds: string[] }) => void
}

export type AddRuleTargetsModalProps = AddRuleTargetsModalBaseProps

const TABS = [
  { key: 'roles', labelKey: 'addRuleTargets.rolesTab' },
  { key: 'members', labelKey: 'addRuleTargets.membersTab' },
] as const satisfies ReadonlyArray<{ key: TabKey, labelKey: 'addRuleTargets.rolesTab' | 'addRuleTargets.membersTab' }>

const AddRuleTargetsModalBody = ({
  ruleName,
  initialRoleIds = [],
  initialMemberIds = [],
  onClose,
  onSubmit,
}: AddRuleTargetsModalBaseProps) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<TabKey>('roles')
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(initialRoleIds)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(initialMemberIds)

  const handleConfirm = useCallback(() => {
    onSubmit({ roleIds: selectedRoleIds, memberIds: selectedMemberIds })
    onClose()
  }, [onClose, onSubmit, selectedMemberIds, selectedRoleIds])

  const description = ruleName
    ? t('addRuleTargets.descriptionWithName', { ns: 'permission', name: ruleName })
    : t('addRuleTargets.description', { ns: 'permission' })

  const summary = t('addRuleTargets.selectedSummary', {
    ns: 'permission',
    roleCount: selectedRoleIds.length,
    memberCount: selectedMemberIds.length,
  })

  return (
    <DialogContent
      className="flex h-132 w-120 flex-col overflow-hidden p-0"
      backdropProps={{ forceRender: true }}
    >
      <div className="relative shrink-0 px-6 pt-6 pb-4">
        <DialogCloseButton />
        <div className="pr-8">
          <DialogTitle className="system-xl-semibold text-text-primary">
            {t('addRuleTargets.title', { ns: 'permission' })}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {description}
          </DialogDescription>
        </div>
      </div>

      <div className="shrink-0 border-b border-divider-subtle px-6">
        <div role="tablist" aria-label={t('addRuleTargets.targetsAria', { ns: 'permission' })} className="flex items-center gap-6">
          {TABS.map((tab) => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  '-mb-px border-b-2 py-2.5 system-sm-semibold-uppercase tracking-wide transition-colors outline-none',
                  active
                    ? 'border-components-tab-active text-text-primary'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary',
                )}
              >
                {t(tab.labelKey, { ns: 'permission' })}
              </button>
            )
          })}
        </div>
      </div>

      {activeTab === 'roles' && (
        <RolesTab
          selectedRoleIds={selectedRoleIds}
          onSelectedRoleIdsChange={setSelectedRoleIds}
        />
      )}
      {activeTab === 'members' && (
        <MembersTab
          selectedMemberIds={selectedMemberIds}
          onSelectedMemberIdsChange={setSelectedMemberIds}
        />
      )}

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-divider-subtle px-6 py-4">
        <div className="system-xs-regular text-text-tertiary">
          {summary}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            {t('operation.confirm', { ns: 'common' })}
          </Button>
        </div>
      </div>
    </DialogContent>
  )
}

const AddRuleTargetsModal = ({
  ruleName,
  initialRoleIds,
  initialMemberIds,
  onClose,
  onSubmit,
}: AddRuleTargetsModalProps) => {
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <AddRuleTargetsModalBody
        ruleName={ruleName}
        initialRoleIds={initialRoleIds}
        initialMemberIds={initialMemberIds}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </Dialog>
  )
}

export default AddRuleTargetsModal
