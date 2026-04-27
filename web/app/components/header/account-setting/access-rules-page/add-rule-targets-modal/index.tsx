'use client'

import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useCallback, useMemo, useState } from 'react'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'
import { useMembers } from '@/service/use-common'

export type AssignableRoleOption = {
  id: string
  name: string
  description?: string
}

export type AssignableMemberOption = {
  id: string
  name: string
  email: string
  avatarUrl?: string | null
}

type TabKey = 'roles' | 'members'

type AddRuleTargetsModalBaseProps = {
  ruleName?: string
  initialRoleIds?: string[]
  initialMemberIds?: string[]
  onClose: () => void
  onSubmit: (selection: { roleIds: string[], memberIds: string[] }) => void
}

export type AddRuleTargetsModalProps = AddRuleTargetsModalBaseProps & {
  open: boolean
}

const TABS: Array<{ key: TabKey, label: string }> = [
  { key: 'roles', label: 'ROLES' },
  { key: 'members', label: 'MEMBERS' },
]

// TODO: replace with roles fetched from the permissions API once available.
const MOCK_ROLE_OPTIONS: AssignableRoleOption[] = [
  { id: 'admin', name: 'Admin', description: 'Full workspace management' },
  { id: 'editor', name: 'Editor', description: 'Create and edit resources' },
  { id: 'member', name: 'Member', description: 'Basic access' },
  { id: 'auditor', name: 'Auditor', description: 'View logs and audit trails' },
  { id: 'tester', name: 'Tester', description: 'Test in sandbox' },
]

const toMemberOption = (member: Member): AssignableMemberOption => ({
  id: member.id,
  name: member.name,
  email: member.email,
  avatarUrl: member.avatar_url ?? member.avatar ?? null,
})

const AddRuleTargetsModalBody = ({
  ruleName,
  initialRoleIds = [],
  initialMemberIds = [],
  onClose,
  onSubmit,
}: AddRuleTargetsModalBaseProps) => {
  const { data: membersData, isLoading: membersLoading } = useMembers()

  const roles = MOCK_ROLE_OPTIONS

  const members = useMemo<AssignableMemberOption[]>(() => {
    const accounts = membersData?.accounts ?? []
    return accounts
      .filter(account => account.status !== 'banned' && account.status !== 'closed')
      .map(toMemberOption)
  }, [membersData])
  const [activeTab, setActiveTab] = useState<TabKey>('roles')
  const [keyword, setKeyword] = useState('')
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>(initialRoleIds)
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(initialMemberIds)

  const trimmed = keyword.trim().toLowerCase()

  const filteredRoles = useMemo(() => {
    if (!trimmed)
      return roles
    return roles.filter(
      role =>
        role.name.toLowerCase().includes(trimmed)
        || role.description?.toLowerCase().includes(trimmed),
    )
  }, [roles, trimmed])

  const filteredMembers = useMemo(() => {
    if (!trimmed)
      return members
    return members.filter(
      member =>
        member.name.toLowerCase().includes(trimmed)
        || member.email.toLowerCase().includes(trimmed),
    )
  }, [members, trimmed])

  const handleSwitchTab = useCallback((tab: TabKey) => {
    setActiveTab(tab)
    setKeyword('')
  }, [])

  const toggleRole = useCallback((id: string) => {
    setSelectedRoleIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  }, [])

  const toggleMember = useCallback((id: string) => {
    setSelectedMemberIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  }, [])

  const handleConfirm = useCallback(() => {
    onSubmit({ roleIds: selectedRoleIds, memberIds: selectedMemberIds })
    onClose()
  }, [onClose, onSubmit, selectedMemberIds, selectedRoleIds])

  const description = ruleName
    ? `Select roles or members to grant the "${ruleName}" access level by default.`
    : 'Select roles or members to grant this access level by default.'

  const summary = (() => {
    const parts: string[] = []
    parts.push(`${selectedRoleIds.length} ${selectedRoleIds.length === 1 ? 'role' : 'roles'}`)
    parts.push(`${selectedMemberIds.length} ${selectedMemberIds.length === 1 ? 'member' : 'members'} selected`)
    return parts.join(', ')
  })()

  return (
    <DialogContent
      className="flex h-[528px] w-[480px] flex-col overflow-hidden p-0"
      backdropProps={{ forceRender: true }}
    >
      <div className="relative shrink-0 px-6 pt-6 pb-4">
        <DialogCloseButton />
        <div className="pr-8">
          <DialogTitle className="system-xl-semibold text-text-primary">
            Add Roles or Members
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {description}
          </DialogDescription>
        </div>
      </div>

      <div className="shrink-0 border-b border-divider-subtle px-6">
        <div role="tablist" aria-label="Targets" className="flex items-center gap-6">
          {TABS.map((tab) => {
            const active = activeTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => handleSwitchTab(tab.key)}
                className={cn(
                  '-mb-px border-b-2 py-2.5 system-sm-semibold-uppercase tracking-wide transition-colors outline-none',
                  active
                    ? 'border-components-tab-active text-text-primary'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary',
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="shrink-0 px-6 pt-3 pb-2">
        <Input
          showLeftIcon
          showClearIcon
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
          placeholder={
            activeTab === 'roles' ? 'Search roles...' : 'Search members...'
          }
        />
      </div>

      <ScrollArea
        className="min-h-0 flex-1"
        slotClassNames={{ viewport: 'px-3 overscroll-contain' }}
      >
        {activeTab === 'roles' && (
          filteredRoles.length === 0
            ? (
                <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                  No matching roles
                </div>
              )
            : (
                <ul className="flex flex-col gap-0.5 pb-2">
                  {filteredRoles.map((role) => {
                    const checked = selectedRoleIds.includes(role.id)
                    const handleToggle = () => toggleRole(role.id)
                    return (
                      <li key={role.id}>
                        <div
                          role="checkbox"
                          aria-checked={checked}
                          tabIndex={0}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-state-base-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-components-input-border-active',
                            checked && 'bg-state-accent-hover hover:bg-state-accent-hover',
                          )}
                          onClick={handleToggle}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault()
                              handleToggle()
                            }
                          }}
                        >
                          <Checkbox
                            checked={checked}
                            className="pointer-events-none mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="system-sm-semibold text-text-secondary">
                              {role.name}
                            </div>
                            {role.description && (
                              <div className="mt-0.5 system-xs-regular text-text-tertiary">
                                {role.description}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )
        )}
        {activeTab === 'members' && (
          membersLoading
            ? (
                <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                  Loading members...
                </div>
              )
            : filteredMembers.length === 0
              ? (
                  <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                    No matching members
                  </div>
                )
              : (
                  <ul className="flex flex-col gap-0.5 pb-2">
                    {filteredMembers.map((member) => {
                      const checked = selectedMemberIds.includes(member.id)
                      const handleToggle = () => toggleMember(member.id)
                      return (
                        <li key={member.id}>
                          <div
                            role="checkbox"
                            aria-checked={checked}
                            tabIndex={0}
                            className={cn(
                              'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-state-base-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-components-input-border-active',
                              checked && 'bg-state-accent-hover hover:bg-state-accent-hover',
                            )}
                            onClick={handleToggle}
                            onKeyDown={(e) => {
                              if (e.key === ' ' || e.key === 'Enter') {
                                e.preventDefault()
                                handleToggle()
                              }
                            }}
                          >
                            <Checkbox
                              checked={checked}
                              className="pointer-events-none"
                            />
                            <Avatar
                              avatar={member.avatarUrl ?? null}
                              name={member.name}
                              size="md"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="system-sm-semibold text-text-secondary">
                                {member.name}
                              </div>
                              <div className="mt-0.5 truncate system-xs-regular text-text-tertiary">
                                {member.email}
                              </div>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )
        )}
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-divider-subtle px-6 py-4">
        <div className="system-xs-regular text-text-tertiary">
          {summary}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </DialogContent>
  )
}

const AddRuleTargetsModal = ({
  open,
  ruleName,
  initialRoleIds,
  initialMemberIds,
  onClose,
  onSubmit,
}: AddRuleTargetsModalProps) => {
  return (
    <Dialog
      open={open}
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
