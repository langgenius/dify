'use client'

import type { Member } from '@/models/common'
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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import Input from '@/app/components/base/input'

export type AssignableRole = {
  id: string
  name: string
  description?: string
}

export type AssignRolesModalProps = {
  open: boolean
  member: Member
  onClose: () => void
  onSubmit: (roleIds: string[]) => void
}

type AssignRolesModalBodyProps = {
  roles: AssignableRole[]
} & Omit<AssignRolesModalProps, 'open'>

// TODO: replace with roles fetched from the permissions API once available.
const MOCK_ASSIGNABLE_ROLES: AssignableRole[] = [
  { id: 'admin', name: 'Admin', description: 'Full access to workspace management and settings' },
  { id: 'editor', name: 'Editor', description: 'Create and edit resources without settings access' },
  { id: 'member', name: 'Member', description: 'Basic workspace access' },
  { id: 'auditor', name: 'Auditor', description: 'View application logs and audit trails' },
  { id: 'tester', name: 'Tester', description: 'Test applications in sandbox environments' },
]

const AssignRolesModalBody = ({
  roles,
  member,
  onClose,
  onSubmit,
}: AssignRolesModalBodyProps) => {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>(() => {
    const match = MOCK_ASSIGNABLE_ROLES.find(r => r.id === member.role)
    return match ? [match.id] : []
  })
  const [keyword, setKeyword] = useState('')

  const filteredRoles = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase()
    if (!trimmed)
      return roles
    return roles.filter(
      role =>
        role.name.toLowerCase().includes(trimmed)
        || role.description?.toLowerCase().includes(trimmed),
    )
  }, [roles, keyword])

  const toggle = (id: string) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  }

  const handleConfirm = () => {
    onSubmit(selected)
    onClose()
  }

  return (
    <DialogContent
      className="flex h-[484px] w-[480px] flex-col overflow-hidden p-0"
      backdropProps={{ forceRender: true }}
    >
      <div className="relative shrink-0 px-6 pt-6 pb-4">
        <DialogCloseButton />
        <div className="pr-8">
          <DialogTitle className="system-xl-semibold text-text-primary">
            {t('members.assignRolesModal.title', { ns: 'common', defaultValue: 'Assign Roles' })}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t('members.assignRolesModal.description', {
              ns: 'common',
              defaultValue:
                'Select roles to assign to this member. All permissions from selected roles will be combined.',
            })}
          </DialogDescription>
        </div>
      </div>

      <div className="shrink-0 px-6">
        <Input
          showLeftIcon
          showClearIcon
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
          placeholder={t('members.assignRolesModal.searchPlaceholder', {
            ns: 'common',
            defaultValue: 'Search roles...',
          })}
        />
      </div>

      <ScrollArea
        className="mt-2 min-h-0 flex-1"
        slotClassNames={{ viewport: 'px-3 overscroll-contain' }}
      >
        {filteredRoles.length === 0
          ? (
              <div className="px-3 py-6 text-center system-sm-regular text-text-tertiary">
                {t('members.assignRolesModal.empty', {
                  ns: 'common',
                  defaultValue: 'No matching roles',
                })}
              </div>
            )
          : (
              <ul className="flex flex-col gap-0.5">
                {filteredRoles.map((role) => {
                  const checked = selected.includes(role.id)
                  const handleToggle = () => toggle(role.id)
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
            )}
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-divider-subtle px-6 py-4">
        <div className="system-xs-regular text-text-tertiary">
          {t('members.assignRolesModal.selectedCount', {
            ns: 'common',
            count: selected.length,
            defaultValue: '{{count}} selected',
          })}
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

const AssignRolesModal = ({
  open,
  member,
  onClose,
  onSubmit,
}: AssignRolesModalProps) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <AssignRolesModalBody
        roles={MOCK_ASSIGNABLE_ROLES}
        member={member}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </Dialog>
  )
}

export default AssignRolesModal
