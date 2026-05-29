'use client'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessSubjectSelectionList } from '@/app/components/base/access-subject-selector'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control'
import useAccessControlStore from '../../../../context/access-control-store'
import { Infotip } from '../../base/infotip'
import AddMemberOrGroupDialog from './add-member-or-group-pop'

export type SpecificGroupsOrMembersProps = {
  loadSubjects?: boolean
  loading?: boolean
}

export default function SpecificGroupsOrMembers({
  loadSubjects = true,
  loading = false,
}: SpecificGroupsOrMembersProps) {
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const appId = useAccessControlStore(s => s.appId)
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const setSpecificGroups = useAccessControlStore(s => s.setSpecificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const setSpecificMembers = useAccessControlStore(s => s.setSpecificMembers)
  const { t } = useTranslation()

  const { isPending, data } = useAppWhiteListSubjects(
    appId,
    loadSubjects && Boolean(appId) && currentMenu === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )
  useEffect(() => {
    if (!loadSubjects)
      return
    setSpecificGroups(data?.groups ?? [])
    setSpecificMembers(data?.members ?? [])
  }, [data, loadSubjects, setSpecificGroups, setSpecificMembers])

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
          <AddMemberOrGroupDialog />
        </div>
      </div>
      <div className="px-1 pb-1">
        <AccessSubjectSelectionList
          selectedGroups={specificGroups}
          selectedMembers={specificMembers}
          loading={loadSubjects ? isPending : loading}
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
