'use client'
import type { Subject } from '@/models/access-control'
import type { App } from '@/types/app'
import { Description as DialogDescription, DialogTitle } from '@headlessui/react'
import { RiBuildingLine, RiGlobalLine, RiVerifiedBadgeLine } from '@remixicon/react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { AccessMode, SubjectType } from '@/models/access-control'
import { useUpdateAccessMode } from '@/service/access-control'
import useAccessControlStore from '../../../../context/access-control-store'
import Button from '../../base/button'
import Toast from '../../base/toast'
import AccessControlDialog from './access-control-dialog'
import AccessControlItem from './access-control-item'
import SpecificGroupsOrMembers, { WebAppSSONotEnabledTip } from './specific-groups-or-members'

type AccessControlProps = {
  app: App
  onClose: () => void
  onConfirm?: () => void
}

export default function AccessControl(props: AccessControlProps) {
  const { app, onClose, onConfirm } = props
  const { t } = useTranslation()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const setAppId = useAccessControlStore(s => s.setAppId)
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const setCurrentMenu = useAccessControlStore(s => s.setCurrentMenu)
  const hideTip = systemFeatures.webapp_auth.enabled
    && (systemFeatures.webapp_auth.allow_sso
      || systemFeatures.webapp_auth.allow_email_password_login
      || systemFeatures.webapp_auth.allow_email_code_login)

  useEffect(() => {
    setAppId(app.id)
    setCurrentMenu(app.access_mode ?? AccessMode.SPECIFIC_GROUPS_MEMBERS)
  }, [app, setAppId, setCurrentMenu])

  const { isPending, mutateAsync: updateAccessMode } = useUpdateAccessMode()
  const handleConfirm = useCallback(async () => {
    const submitData: {
      appId: string
      accessMode: AccessMode
      subjects?: Pick<Subject, 'subjectId' | 'subjectType'>[]
    } = { appId: app.id, accessMode: currentMenu }
    if (currentMenu === AccessMode.SPECIFIC_GROUPS_MEMBERS) {
      const subjects: Pick<Subject, 'subjectId' | 'subjectType'>[] = []
      specificGroups.forEach((group) => {
        subjects.push({ subjectId: group.id, subjectType: SubjectType.GROUP })
      })
      specificMembers.forEach((member) => {
        subjects.push({
          subjectId: member.id,
          subjectType: SubjectType.ACCOUNT,
        })
      })
      submitData.subjects = subjects
    }
    await updateAccessMode(submitData)
    Toast.notify({ type: 'success', message: t('accessControlDialog.updateSuccess', { ns: 'app' }) })
    onConfirm?.()
  }, [updateAccessMode, app, specificGroups, specificMembers, t, onConfirm, currentMenu])
  return (
    <AccessControlDialog show onClose={onClose}>
      <div className="flex flex-col gap-y-3">
        <div className="pb-3 pl-6 pr-14 pt-6">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">{t('accessControlDialog.title', { ns: 'app' })}</DialogTitle>
          <DialogDescription className="system-xs-regular mt-1 text-text-tertiary">{t('accessControlDialog.description', { ns: 'app' })}</DialogDescription>
        </div>
        <div className="flex flex-col gap-y-1 px-6 pb-3">
          <div className="leading-6">
            <p className="system-sm-medium text-text-tertiary">{t('accessControlDialog.accessLabel', { ns: 'app' })}</p>
          </div>
          <AccessControlItem type={AccessMode.ORGANIZATION}>
            <div className="flex items-center p-3">
              <div className="flex grow items-center gap-x-2">
                <RiBuildingLine className="h-4 w-4 text-text-primary" />
                <p className="system-sm-medium text-text-primary">{t('accessControlDialog.accessItems.organization', { ns: 'app' })}</p>
              </div>
            </div>
          </AccessControlItem>
          <AccessControlItem type={AccessMode.SPECIFIC_GROUPS_MEMBERS}>
            <SpecificGroupsOrMembers />
          </AccessControlItem>
          <AccessControlItem type={AccessMode.EXTERNAL_MEMBERS}>
            <div className="flex items-center p-3">
              <div className="flex grow items-center gap-x-2">
                <RiVerifiedBadgeLine className="h-4 w-4 text-text-primary" />
                <p className="system-sm-medium text-text-primary">{t('accessControlDialog.accessItems.external', { ns: 'app' })}</p>
              </div>
              {!hideTip && <WebAppSSONotEnabledTip />}
            </div>
          </AccessControlItem>
          <AccessControlItem type={AccessMode.PUBLIC}>
            <div className="flex items-center gap-x-2 p-3">
              <RiGlobalLine className="h-4 w-4 text-text-primary" />
              <p className="system-sm-medium text-text-primary">{t('accessControlDialog.accessItems.anyone', { ns: 'app' })}</p>
            </div>
          </AccessControlItem>
        </div>
        <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
          <Button onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
          <Button disabled={isPending} loading={isPending} variant="primary" onClick={handleConfirm}>{t('operation.confirm', { ns: 'common' })}</Button>
        </div>
      </div>
    </AccessControlDialog>
  )
}
