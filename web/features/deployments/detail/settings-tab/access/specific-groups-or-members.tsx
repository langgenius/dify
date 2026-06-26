'use client'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { AccessMode } from '@/models/access-control'
import { AccessSubjectSelectionList } from './access-subject-selector/selection-list'
import { AddMemberOrGroupDialog } from './add-member-or-group-pop'
import { useAccessControlStore } from './store'

export type SpecificGroupsOrMembersProps = {
  loading?: boolean
}

export function SpecificGroupsOrMembers({
  loading = false,
}: SpecificGroupsOrMembersProps) {
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const setSpecificMembers = useAccessControlStore(s => s.setSpecificMembers)
  const { t } = useTranslation()

  if (currentMenu !== AccessMode.SPECIFIC_GROUPS_MEMBERS) {
    return (
      <div className="flex items-center p-3">
        <div className="flex grow items-center gap-x-2">
          <span className="i-ri-lock-line size-4 text-text-primary" aria-hidden="true" />
          <p className="system-sm-medium text-text-primary">{t('accessControlDialog.accessItems.specific', { ns: 'app' })}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-x-1 p-3">
        <div className="flex grow items-center gap-x-1">
          <span className="i-ri-lock-line size-4 text-text-primary" aria-hidden="true" />
          <p className="system-sm-medium text-text-primary">{t('accessControlDialog.accessItems.specific', { ns: 'app' })}</p>
        </div>
        <div className="flex items-center gap-x-1">
          <AddMemberOrGroupDialog disabled={loading} />
        </div>
      </div>
      <div className="px-1 pb-1">
        <AccessSubjectSelectionList
          selectedGroups={specificGroups}
          selectedMembers={specificMembers}
          loading={loading}
          onChange={({ groups, members }) => {
            setSpecificGroups(groups)
            setSpecificMembers(members)
          }}
        />
      </div>
    </div>
  )
}

export function WebAppSSONotEnabledTip() {
  const { t } = useTranslation()
  const tip = t('accessControlDialog.webAppSSONotEnabledTip', { ns: 'app' })

  return (
    <Infotip
      aria-label={tip}
      iconClassName="h-4 w-4 shrink-0 text-text-warning-secondary hover:text-text-warning-secondary"
    >
      {tip}
    </Infotip>
  )
}
