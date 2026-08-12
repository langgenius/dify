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
import { ComboboxItem, ComboboxItemText } from '@langgenius/dify-ui/combobox'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { SubjectType } from '@/models/access-control'

type SubjectItemProps = {
  subject: Subject
  selectedGroups: AccessControlGroup[]
  onExpandGroup: (group: AccessControlGroup) => void
}

export function SubjectItem({ subject, selectedGroups, onExpandGroup }: SubjectItemProps) {
  if (subject.subjectType === SubjectType.GROUP)
    return (
      <GroupItem
        group={(subject as SubjectGroup).groupData}
        subject={subject}
        selectedGroups={selectedGroups}
        onExpand={onExpandGroup}
      />
    )

  return <MemberItem member={(subject as SubjectAccount).accountData} subject={subject} />
}

type GroupItemProps = {
  group: AccessControlGroup
  subject: Subject
  selectedGroups: AccessControlGroup[]
  onExpand: (group: AccessControlGroup) => void
}

function GroupItem({ group, subject, selectedGroups, onExpand }: GroupItemProps) {
  const { t } = useTranslation()
  const isChecked = selectedGroups.some((selectedGroup) => selectedGroup.id === group.id)

  return (
    <div className="flex items-center gap-2 rounded-lg hover:bg-state-base-hover">
      <BaseItem subject={subject}>
        {(selected) => (
          <>
            <SelectionBox checked={selected} />
            <ComboboxItemText className="flex grow items-center px-0">
              <div className="mr-2 size-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
                <div className="bg-access-app-icon-mask-bg flex size-full items-center justify-center">
                  <span
                    aria-hidden="true"
                    className="i-ri-organization-chart h-3.5 w-3.5 text-components-avatar-shape-fill-stop-0"
                  />
                </div>
              </div>
              <span className="mr-1 system-sm-medium text-text-secondary">{group.name}</span>
              <span className="system-xs-regular text-text-tertiary">{group.groupSize}</span>
            </ComboboxItemText>
          </>
        )}
      </BaseItem>
      <Button
        size="small"
        disabled={isChecked}
        variant="ghost-accent"
        className="mr-1 flex shrink-0 items-center justify-between py-1"
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => onExpand(group)}
      >
        <span>
          {t(($) => $['accessControlDialog.operateGroupAndMember.expand'], { ns: 'app' })}
        </span>
        <span aria-hidden="true" className="i-ri-arrow-right-s-line size-4" />
      </Button>
    </div>
  )
}

function MemberItem({ member, subject }: { member: AccessControlAccount; subject: Subject }) {
  const { data: currentUser } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile,
  })
  const { t } = useTranslation()

  return (
    <BaseItem subject={subject} className="pr-3">
      {(selected) => (
        <>
          <SelectionBox checked={selected} />
          <ComboboxItemText className="flex grow items-center px-0">
            <div className="mr-2 size-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
              <div className="bg-access-app-icon-mask-bg flex size-full items-center justify-center">
                <Avatar size="xxs" avatar={null} name={member.name} />
              </div>
            </div>
            <span className="mr-1 system-sm-medium text-text-secondary">{member.name}</span>
            {currentUser.email === member.email && (
              <span className="system-xs-regular text-text-tertiary">
                ({t(($) => $.you, { ns: 'common' })})
              </span>
            )}
          </ComboboxItemText>
          <span className="system-xs-regular text-text-quaternary">{member.email}</span>
        </>
      )}
    </BaseItem>
  )
}

function BaseItem({
  children,
  className,
  subject,
}: {
  className?: string
  subject: Subject
  children: (selected: boolean) => ReactNode
}) {
  return (
    <ComboboxItem
      value={subject}
      className={cn(
        'mx-0 flex min-h-8 grow grid-cols-none items-center gap-2 rounded-lg p-1 pl-2',
        className,
      )}
      render={(props, state) => (
        <div {...props} className={props.className}>
          {children(state.selected)}
        </div>
      )}
    />
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
