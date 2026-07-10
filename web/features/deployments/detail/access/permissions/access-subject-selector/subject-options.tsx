'use client'

import type { ReactNode } from 'react'
import type {
  AccessControlAccount,
  AccessControlGroup,
  Subject,
  SubjectAccount,
  SubjectGroup,
} from '@/models/access-control'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ComboboxItem,
  ComboboxItemText,
} from '@langgenius/dify-ui/combobox'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { userProfileAtom } from '@/context/account-state'
import { SubjectType } from '@/models/access-control'

export function SubjectItem({
  subject,
  selectedGroups,
  selectedMembers,
  onExpandGroup,
}: {
  subject: Subject
  selectedGroups: AccessControlGroup[]
  selectedMembers: AccessControlAccount[]
  onExpandGroup: (group: AccessControlGroup) => void
}) {
  if (subject.subjectType === SubjectType.GROUP) {
    return (
      <GroupItem
        group={(subject as SubjectGroup).groupData}
        subject={subject}
        selectedGroups={selectedGroups}
        onExpandGroup={onExpandGroup}
      />
    )
  }

  return (
    <MemberItem
      member={(subject as SubjectAccount).accountData}
      subject={subject}
      selectedMembers={selectedMembers}
    />
  )
}

export function SelectedGroupsBreadCrumb({
  selectedGroupsForBreadcrumb,
  onChange,
}: {
  selectedGroupsForBreadcrumb: AccessControlGroup[]
  onChange: (groups: AccessControlGroup[]) => void
}) {
  const { t } = useTranslation()

  const handleBreadCrumbClick = (index: number) => {
    const newGroups = selectedGroupsForBreadcrumb.slice(0, index + 1)
    onChange(newGroups)
  }
  const handleReset = () => {
    onChange([])
  }
  const hasBreadcrumb = selectedGroupsForBreadcrumb.length > 0

  return (
    <div className="flex h-7 items-center gap-x-0.5 px-2 py-0.5">
      {hasBreadcrumb
        ? (
            <button
              type="button"
              className="cursor-pointer border-none bg-transparent p-0 text-left system-xs-regular text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
              onClick={handleReset}
            >
              {t($ => $['accessControlDialog.operateGroupAndMember.allMembers'], { ns: 'app' })}
            </button>
          )
        : (
            <span className="system-xs-regular text-text-tertiary">{t($ => $['accessControlDialog.operateGroupAndMember.allMembers'], { ns: 'app' })}</span>
          )}
      {selectedGroupsForBreadcrumb.map((group, index) => {
        const isLastGroup = index === selectedGroupsForBreadcrumb.length - 1

        return (
          <div key={group.id} className="flex items-center gap-x-0.5 system-xs-regular text-text-tertiary">
            <span>/</span>
            {isLastGroup
              ? <span>{group.name}</span>
              : (
                  <button
                    type="button"
                    className="cursor-pointer border-none bg-transparent p-0 text-left system-xs-regular text-text-accent focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                    onClick={() => handleBreadCrumbClick(index)}
                  >
                    {group.name}
                  </button>
                )}
          </div>
        )
      })}
    </div>
  )
}

type GroupItemProps = {
  group: AccessControlGroup
  subject: Subject
  selectedGroups: AccessControlGroup[]
  onExpandGroup: (group: AccessControlGroup) => void
}

function GroupItem({ group, subject, selectedGroups, onExpandGroup }: GroupItemProps) {
  const { t } = useTranslation()
  const isChecked = selectedGroups.some(selectedGroup => selectedGroup.id === group.id)

  return (
    <div className="flex items-center gap-2 rounded-lg hover:bg-state-base-hover">
      <ComboboxBaseItem subject={subject}>
        <SelectionBox checked={isChecked} />
        <ComboboxItemText className="flex grow items-center px-0">
          <div className="mr-2 size-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
            <div className="flex size-full items-center justify-center bg-[image:var(--color-access-app-icon-mask-bg)]">
              <span className="i-ri-organization-chart h-[14px] w-[14px] text-components-avatar-shape-fill-stop-0" aria-hidden="true" />
            </div>
          </div>
          <span className="mr-1 system-sm-medium text-text-secondary">{group.name}</span>
          <span className="system-xs-regular text-text-tertiary">{group.groupSize}</span>
        </ComboboxItemText>
      </ComboboxBaseItem>
      <Button
        size="small"
        disabled={isChecked}
        variant="ghost-accent"
        className="mr-1 flex shrink-0 items-center justify-between px-1.5 py-1"
        onPointerDown={event => event.preventDefault()}
        onClick={() => onExpandGroup(group)}
      >
        <span className="px-[3px]">{t($ => $['accessControlDialog.operateGroupAndMember.expand'], { ns: 'app' })}</span>
        <span className="i-ri-arrow-right-s-line size-4" aria-hidden="true" />
      </Button>
    </div>
  )
}

type MemberItemProps = {
  member: AccessControlAccount
  subject: Subject
  selectedMembers: AccessControlAccount[]
}

function MemberItem({ member, subject, selectedMembers }: MemberItemProps) {
  const currentUser = useAtomValue(userProfileAtom)
  const { t } = useTranslation()
  const isChecked = selectedMembers.some(selectedMember => selectedMember.id === member.id)
  return (
    <ComboboxBaseItem subject={subject} className="pr-3">
      <SelectionBox checked={isChecked} />
      <ComboboxItemText className="flex grow items-center px-0">
        <div className="mr-2 size-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
          <div className="flex size-full items-center justify-center bg-[image:var(--color-access-app-icon-mask-bg)]">
            <Avatar size="xxs" avatar={null} name={member.name} />
          </div>
        </div>
        <span className="mr-1 system-sm-medium text-text-secondary">{member.name}</span>
        {currentUser.email === member.email && (
          <span className="system-xs-regular text-text-tertiary">
            (
            {t($ => $.you, { ns: 'common' })}
            )
          </span>
        )}
      </ComboboxItemText>
      <span className="system-xs-regular text-text-quaternary">{member.email}</span>
    </ComboboxBaseItem>
  )
}

type ComboboxBaseItemProps = {
  className?: string
  subject: Subject
  children: ReactNode
}

function ComboboxBaseItem({ children, className, subject }: ComboboxBaseItemProps) {
  return (
    <ComboboxItem
      value={subject}
      className={cn(
        'mx-0 flex min-h-8 grow grid-cols-none items-center gap-2 rounded-lg p-1 pl-2',
        className,
      )}
    >
      {children}
    </ComboboxItem>
  )
}

function SelectionBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-sm shadow-xs shadow-shadow-shadow-3',
        checked
          ? 'bg-components-checkbox-bg text-components-checkbox-icon'
          : 'border border-components-checkbox-border bg-components-checkbox-bg-unchecked',
      )}
    >
      {checked && <span className="i-ri-check-line size-3" />}
    </span>
  )
}
