'use client'

import type { ReactNode } from 'react'
import type { AccessSubjectSelectionProps } from './types'
import type {
  AccessControlAccount,
  AccessControlGroup,
} from '@/models/access-control'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { SkeletonRectangle } from '@/app/components/base/skeleton'

type AccessSubjectSelectionListProps = AccessSubjectSelectionProps & {
  loading?: boolean
  className?: string
}

export function AccessSubjectSelectionList({
  selectedGroups,
  selectedMembers,
  onChange,
  loading,
  className,
}: AccessSubjectSelectionListProps) {
  return (
    <div className={cn('flex max-h-[400px] flex-col gap-y-2 overflow-y-auto rounded-lg bg-background-section p-2', className)}>
      {loading
        ? <AccessSubjectSelectionListSkeleton />
        : (
            <RenderGroupsAndMembers
              selectedGroups={selectedGroups}
              selectedMembers={selectedMembers}
              onChange={onChange}
            />
          )}
    </div>
  )
}

function AccessSubjectSelectionListSkeleton() {
  const { t } = useTranslation()

  return (
    <div role="status" aria-busy="true" aria-label={t($ => $.loading, { ns: 'common' })} className="flex flex-col gap-y-2">
      <SkeletonRectangle className="my-0 h-3 w-14 animate-pulse" />
      <div className="flex flex-row flex-wrap gap-1">
        {[0, 1].map(index => (
          <SelectedItemSkeleton key={index} withMeta />
        ))}
      </div>
      <SkeletonRectangle className="my-0 h-3 w-16 animate-pulse" />
      <div className="flex flex-row flex-wrap gap-1">
        {[0, 1, 2].map(index => (
          <SelectedItemSkeleton key={index} />
        ))}
      </div>
    </div>
  )
}

function SelectedItemSkeleton({ withMeta = false }: {
  withMeta?: boolean
}) {
  return (
    <div className="flex items-center gap-x-1 rounded-full border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark p-1 pr-1.5 shadow-xs">
      <SkeletonRectangle className="my-0 size-5 animate-pulse rounded-full" />
      <SkeletonRectangle className="my-0 h-3 w-20 animate-pulse" />
      {withMeta && <SkeletonRectangle className="my-0 h-3 w-5 animate-pulse" />}
      <SkeletonRectangle className="my-0 size-4 animate-pulse rounded-full" />
    </div>
  )
}

function RenderGroupsAndMembers({
  selectedGroups,
  selectedMembers,
  onChange,
}: AccessSubjectSelectionProps) {
  const { t } = useTranslation()
  if (selectedGroups.length <= 0 && selectedMembers.length <= 0) {
    return (
      <div className="px-2 pt-5 pb-1.5">
        <p className="text-center system-xs-regular text-text-tertiary">
          {t($ => $['accessControlDialog.noGroupsOrMembers'], { ns: 'app' })}
        </p>
      </div>
    )
  }

  return (
    <>
      <p className="sticky top-0 system-2xs-medium-uppercase text-text-tertiary">
        {t($ => $['accessControlDialog.groups'], { ns: 'app', count: selectedGroups.length ?? 0 })}
      </p>
      <div className="flex flex-row flex-wrap gap-1">
        {selectedGroups.map(group => (
          <SelectedGroupItem
            key={group.id}
            group={group}
            selectedGroups={selectedGroups}
            selectedMembers={selectedMembers}
            onChange={onChange}
          />
        ))}
      </div>
      <p className="sticky top-0 system-2xs-medium-uppercase text-text-tertiary">
        {t($ => $['accessControlDialog.members'], { ns: 'app', count: selectedMembers.length ?? 0 })}
      </p>
      <div className="flex flex-row flex-wrap gap-1">
        {selectedMembers.map(member => (
          <SelectedMemberItem
            key={member.id}
            member={member}
            selectedGroups={selectedGroups}
            selectedMembers={selectedMembers}
            onChange={onChange}
          />
        ))}
      </div>
    </>
  )
}

type SelectedGroupItemProps = AccessSubjectSelectionProps & {
  group: AccessControlGroup
}

function SelectedGroupItem({
  group,
  selectedGroups,
  selectedMembers,
  onChange,
}: SelectedGroupItemProps) {
  const handleRemoveGroup = () => {
    onChange({
      groups: selectedGroups.filter(selectedGroup => selectedGroup.id !== group.id),
      members: selectedMembers,
    })
  }

  return (
    <SelectedBaseItem
      icon={<span className="i-ri-organization-chart h-[14px] w-[14px] text-components-avatar-shape-fill-stop-0" aria-hidden="true" />}
      onRemove={handleRemoveGroup}
    >
      <p className="system-xs-regular text-text-primary">{group.name}</p>
      <p className="system-xs-regular text-text-tertiary">{group.groupSize}</p>
    </SelectedBaseItem>
  )
}

type SelectedMemberItemProps = AccessSubjectSelectionProps & {
  member: AccessControlAccount
}

function SelectedMemberItem({
  member,
  selectedGroups,
  selectedMembers,
  onChange,
}: SelectedMemberItemProps) {
  const handleRemoveMember = () => {
    onChange({
      groups: selectedGroups,
      members: selectedMembers.filter(selectedMember => selectedMember.id !== member.id),
    })
  }

  return (
    <SelectedBaseItem
      icon={<Avatar size="xxs" avatar={null} name={member.name} />}
      onRemove={handleRemoveMember}
    >
      <p className="system-xs-regular text-text-primary">{member.name}</p>
    </SelectedBaseItem>
  )
}

type SelectedBaseItemProps = {
  icon: ReactNode
  children: ReactNode
  onRemove?: () => void
}

function SelectedBaseItem({ icon, onRemove, children }: SelectedBaseItemProps) {
  const { t } = useTranslation()

  return (
    <div className="group flex flex-row items-center gap-x-1 rounded-full border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark p-1 pr-1.5 shadow-xs">
      <div className="size-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
        <div className="flex size-full items-center justify-center bg-[image:var(--color-access-app-icon-mask-bg)]">
          {icon}
        </div>
      </div>
      {children}
      <button
        type="button"
        className="flex size-4 cursor-pointer items-center justify-center border-none bg-transparent p-0 focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
        aria-label={t($ => $['operation.remove'], { ns: 'common' })}
        onClick={onRemove}
      >
        <span className="i-ri-close-circle-fill h-[14px] w-[14px] text-text-quaternary" aria-hidden="true" />
      </button>
    </div>
  )
}
