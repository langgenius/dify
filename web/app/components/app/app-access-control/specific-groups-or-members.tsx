'use client'
import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'
import { AccessMode } from '@/models/access-control'
import { Infotip } from '../../base/infotip'
import Loading from '../../base/loading'
import AddMemberOrGroupDialog from './add-member-or-group-pop'

export type AccessControlSubjects = {
  groups: AccessControlGroup[]
  members: AccessControlAccount[]
}

export type AccessControlSubjectsStatus = 'loading' | 'error' | 'success'

type SpecificGroupsOrMembersProps = {
  accessMode: AccessMode
  subjects: AccessControlSubjects
  subjectsStatus: AccessControlSubjectsStatus
  onSubjectsChange: (subjects: AccessControlSubjects) => void
  onRetrySubjects?: () => void
}

export default function SpecificGroupsOrMembers({
  accessMode,
  subjects,
  subjectsStatus,
  onSubjectsChange,
  onRetrySubjects,
}: SpecificGroupsOrMembersProps) {
  const { t } = useTranslation()

  if (accessMode !== AccessMode.SPECIFIC_GROUPS_MEMBERS) {
    return (
      <div className="flex items-center p-3">
        <div className="flex grow items-center gap-x-2">
          <span aria-hidden="true" className="i-ri-lock-line size-4 text-text-primary" />
          <p className="system-sm-medium text-text-primary">
            {t(($) => $['accessControlDialog.accessItems.specific'], { ns: 'app' })}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-x-1 p-3">
        <div className="flex grow items-center gap-x-1">
          <span aria-hidden="true" className="i-ri-lock-line size-4 text-text-primary" />
          <p className="system-sm-medium text-text-primary">
            {t(($) => $['accessControlDialog.accessItems.specific'], { ns: 'app' })}
          </p>
        </div>
        {subjectsStatus === 'success' && (
          <div className="flex items-center gap-x-1">
            <AddMemberOrGroupDialog subjects={subjects} onChange={onSubjectsChange} />
          </div>
        )}
      </div>
      <div className="px-1 pb-1">
        <div className="flex max-h-100 flex-col gap-y-2 overflow-y-auto rounded-lg bg-background-section p-2">
          {subjectsStatus === 'loading' && <Loading />}
          {subjectsStatus === 'error' && (
            <div role="alert" className="flex flex-col items-center gap-2 px-2 py-5">
              <p className="system-xs-regular text-text-tertiary">
                {t(($) => $['dynamicSelect.error'], { ns: 'common' })}
              </p>
              {onRetrySubjects && (
                <Button size="small" onClick={onRetrySubjects}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              )}
            </div>
          )}
          {subjectsStatus === 'success' && (
            <RenderGroupsAndMembers subjects={subjects} onChange={onSubjectsChange} />
          )}
        </div>
      </div>
    </div>
  )
}

type RenderGroupsAndMembersProps = {
  subjects: AccessControlSubjects
  onChange: (subjects: AccessControlSubjects) => void
}

function RenderGroupsAndMembers({ subjects, onChange }: RenderGroupsAndMembersProps) {
  const { t } = useTranslation()
  const { groups, members } = subjects

  if (groups.length <= 0 && members.length <= 0) {
    return (
      <div className="px-2 pt-5 pb-1.5">
        <p className="text-center system-xs-regular text-text-tertiary">
          {t(($) => $['accessControlDialog.noGroupsOrMembers'], { ns: 'app' })}
        </p>
      </div>
    )
  }

  return (
    <>
      <p className="sticky top-0 system-2xs-medium-uppercase text-text-tertiary">
        {t(($) => $['accessControlDialog.groups'], {
          ns: 'app',
          count: groups.length,
        })}
      </p>
      <div className="flex flex-row flex-wrap gap-1">
        {groups.map((group) => (
          <GroupItem
            key={group.id}
            group={group}
            onRemove={() =>
              onChange({
                groups: groups.filter((candidate) => candidate.id !== group.id),
                members,
              })
            }
          />
        ))}
      </div>
      <p className="sticky top-0 system-2xs-medium-uppercase text-text-tertiary">
        {t(($) => $['accessControlDialog.members'], {
          ns: 'app',
          count: members.length,
        })}
      </p>
      <div className="flex flex-row flex-wrap gap-1">
        {members.map((member) => (
          <MemberItem
            key={member.id}
            member={member}
            onRemove={() =>
              onChange({
                groups,
                members: members.filter((candidate) => candidate.id !== member.id),
              })
            }
          />
        ))}
      </div>
    </>
  )
}

type GroupItemProps = {
  group: AccessControlGroup
  onRemove: () => void
}

function GroupItem({ group, onRemove }: GroupItemProps) {
  return (
    <BaseItem
      icon={
        <span
          aria-hidden="true"
          className="i-ri-organization-chart h-3.5 w-3.5 text-components-avatar-shape-fill-stop-0"
        />
      }
      onRemove={onRemove}
    >
      <p className="system-xs-regular text-text-primary">{group.name}</p>
      <p className="system-xs-regular text-text-tertiary">{group.groupSize}</p>
    </BaseItem>
  )
}

type MemberItemProps = {
  member: AccessControlAccount
  onRemove: () => void
}

function MemberItem({ member, onRemove }: MemberItemProps) {
  return (
    <BaseItem icon={<Avatar size="xxs" avatar={null} name={member.name} />} onRemove={onRemove}>
      <p className="system-xs-regular text-text-primary">{member.name}</p>
    </BaseItem>
  )
}

type BaseItemProps = {
  icon: React.ReactNode
  children: React.ReactNode
  onRemove: () => void
}

function BaseItem({ icon, onRemove, children }: BaseItemProps) {
  const { t } = useTranslation()

  return (
    <div className="group flex flex-row items-center gap-x-1 rounded-full border-[0.5px] border-components-panel-border-subtle bg-components-badge-white-to-dark p-1 pr-1.5 shadow-xs">
      <div className="size-5 overflow-hidden rounded-full bg-components-icon-bg-blue-solid">
        <div className="bg-access-app-icon-mask-bg flex size-full items-center justify-center">
          {icon}
        </div>
      </div>
      {children}
      <IconButton
        size="xs"
        className="shrink-0"
        aria-label={t(($) => $['operation.remove'], { ns: 'common' })}
        onClick={onRemove}
      >
        <span
          aria-hidden="true"
          className="i-ri-close-circle-fill h-3.5 w-3.5 text-text-quaternary"
        />
      </IconButton>
    </div>
  )
}

export function WebAppSSONotEnabledTip() {
  const { t } = useTranslation()
  const tip = t(($) => $['accessControlDialog.webAppSSONotEnabledTip'], { ns: 'app' })

  return (
    <Infotip
      aria-label={tip}
      className="text-text-warning-secondary hover:text-text-warning-secondary"
      iconSize="large"
    >
      {tip}
    </Infotip>
  )
}
