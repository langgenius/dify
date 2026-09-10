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
import { Toggle } from '@langgenius/dify-ui/toggle'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { SubjectType } from '@/models/access-control'

type SubjectItemProps = {
  subject: Subject
  selected: boolean
  onToggle: () => void
  onExpandGroup: (group: AccessControlGroup) => void
}

export function SubjectItem({ subject, selected, onToggle, onExpandGroup }: SubjectItemProps) {
  if (subject.subjectType === SubjectType.GROUP)
    return (
      <GroupItem
        group={(subject as SubjectGroup).groupData}
        selected={selected}
        onToggle={onToggle}
        onExpand={onExpandGroup}
      />
    )

  return (
    <MemberItem
      member={(subject as SubjectAccount).accountData}
      selected={selected}
      onToggle={onToggle}
    />
  )
}

function GroupItem({
  group,
  selected,
  onToggle,
  onExpand,
}: {
  group: AccessControlGroup
  selected: boolean
  onToggle: () => void
  onExpand: (group: AccessControlGroup) => void
}) {
  const { t } = useTranslation()

  return (
    <li className="flex min-w-0 items-center gap-2 rounded-lg hover:bg-state-base-hover">
      <SubjectToggleButton selected={selected} onToggle={onToggle}>
        <div className="mr-2 size-5 shrink-0 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
          <div className="bg-access-app-icon-mask-bg flex size-full items-center justify-center">
            <span
              aria-hidden="true"
              className="i-ri-organization-chart size-3.5 text-components-avatar-shape-fill-stop-0"
            />
          </div>
        </div>
        <span className="mr-1 min-w-0 truncate system-sm-medium text-text-secondary">
          {group.name}
        </span>
        <span className="shrink-0 system-xs-regular text-text-tertiary">{group.groupSize}</span>
      </SubjectToggleButton>
      <Button
        size="small"
        disabled={selected}
        variant="ghost-accent"
        className="mr-1 flex shrink-0 items-center justify-between py-1"
        onClick={() => onExpand(group)}
      >
        <span>
          {t(($) => $['accessControlDialog.operateGroupAndMember.expand'], { ns: 'app' })}
        </span>
        <span aria-hidden="true" className="i-ri-arrow-right-s-line size-4" />
      </Button>
    </li>
  )
}

function MemberItem({
  member,
  selected,
  onToggle,
}: {
  member: AccessControlAccount
  selected: boolean
  onToggle: () => void
}) {
  const { data: currentUser } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const { t } = useTranslation()

  return (
    <li>
      <SubjectToggleButton selected={selected} onToggle={onToggle} className="pr-3">
        <div className="mr-2 size-5 shrink-0 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
          <div className="bg-access-app-icon-mask-bg flex size-full items-center justify-center">
            <Avatar size="xxs" avatar={null} name={member.name} />
          </div>
        </div>
        <span className="mr-1 min-w-0 truncate system-sm-medium text-text-secondary">
          {member.name}
        </span>
        {currentUser.email === member.email && (
          <span className="shrink-0 system-xs-regular text-text-tertiary">
            ({t(($) => $.you, { ns: 'common' })})
          </span>
        )}
        <span className="ml-auto min-w-0 truncate system-xs-regular text-text-quaternary">
          {member.email}
        </span>
      </SubjectToggleButton>
    </li>
  )
}

function SubjectToggleButton({
  children,
  selected,
  onToggle,
  className,
}: {
  children: ReactNode
  selected: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <Toggle
      pressed={selected}
      onPressedChange={onToggle}
      render={
        <Button
          variant="ghost"
          size="medium"
          className={cn(
            'min-h-8 min-w-0 grow justify-start gap-2 p-1 pl-2 text-left whitespace-normal',
            className,
          )}
        />
      }
    >
      <SelectionBox checked={selected} />
      {children}
    </Toggle>
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
