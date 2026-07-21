'use client'
import type { Subject } from '@/models/access-control'
import type { App } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { DialogDescription, DialogTitle } from '@langgenius/dify-ui/dialog'
import { RadioGroup } from '@langgenius/dify-ui/radio'
import { toast } from '@langgenius/dify-ui/toast'
import { RiBuildingLine, RiGlobalLine, RiVerifiedBadgeLine } from '@remixicon/react'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode, SubjectType } from '@/models/access-control'
import { consoleQuery } from '@/service/client'
import useAccessControlStore from '../../../../context/access-control-store'
import AccessControlDialog from './access-control-dialog'
import AccessControlItem from './access-control-item'
import SpecificGroupsOrMembers, { WebAppSSONotEnabledTip } from './specific-groups-or-members'

type AccessControlProps = {
  app: Pick<App, 'id' | 'access_mode'>
  onClose: () => void
  onConfirm?: () => void
}

export default function AccessControl(props: AccessControlProps) {
  const { app, onClose, onConfirm } = props
  const { id: appId, access_mode: appAccessMode } = app
  const accessControlOptionsLabelId = useId()
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const setAppId = useAccessControlStore((s) => s.setAppId)
  const specificGroups = useAccessControlStore((s) => s.specificGroups)
  const specificMembers = useAccessControlStore((s) => s.specificMembers)
  const currentMenu = useAccessControlStore((s) => s.currentMenu)
  const setCurrentMenu = useAccessControlStore((s) => s.setCurrentMenu)
  const hideTip =
    systemFeatures.webapp_auth.enabled &&
    (systemFeatures.webapp_auth.allow_sso ||
      systemFeatures.webapp_auth.allow_email_password_login ||
      systemFeatures.webapp_auth.allow_email_code_login)

  useEffect(() => {
    setAppId(appId)
    setCurrentMenu(appAccessMode ?? AccessMode.SPECIFIC_GROUPS_MEMBERS)
  }, [appAccessMode, appId, setAppId, setCurrentMenu])

  const { isPending, mutateAsync: updateAccessMode } = useMutation(
    consoleQuery.enterprise.webAppAuth.updateWebAppWhitelistSubjects.mutationOptions(),
  )
  const handleConfirm = useCallback(async () => {
    const submitData: {
      appId: string
      accessMode: AccessMode
      subjects?: Pick<Subject, 'subjectId' | 'subjectType'>[]
    } = { appId, accessMode: currentMenu }
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
    await updateAccessMode({ body: submitData })
    toast.success(t(($) => $['accessControlDialog.updateSuccess'], { ns: 'app' }))
    onConfirm?.()
  }, [updateAccessMode, appId, specificGroups, specificMembers, t, onConfirm, currentMenu])
  return (
    <AccessControlDialog show onClose={onClose}>
      <div className="flex flex-col gap-y-3">
        <div className="pt-6 pr-14 pb-3 pl-6">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['accessControlDialog.title'], { ns: 'app' })}
          </DialogTitle>
          <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['accessControlDialog.description'], { ns: 'app' })}
          </DialogDescription>
        </div>
        <RadioGroup<AccessMode>
          value={currentMenu}
          onValueChange={setCurrentMenu}
          className="flex flex-col items-stretch gap-y-1 px-6 pb-3"
          aria-labelledby={accessControlOptionsLabelId}
        >
          <div className="leading-6">
            <p id={accessControlOptionsLabelId} className="system-sm-medium text-text-tertiary">
              {t(($) => $['accessControlDialog.accessLabel'], { ns: 'app' })}
            </p>
          </div>
          <AccessControlItem type={AccessMode.ORGANIZATION}>
            <div className="flex items-center p-3">
              <div className="flex grow items-center gap-x-2">
                <RiBuildingLine className="size-4 text-text-primary" />
                <p className="system-sm-medium text-text-primary">
                  {t(($) => $['accessControlDialog.accessItems.organization'], { ns: 'app' })}
                </p>
              </div>
            </div>
          </AccessControlItem>
          <AccessControlItem type={AccessMode.SPECIFIC_GROUPS_MEMBERS}>
            <SpecificGroupsOrMembers />
          </AccessControlItem>
          <AccessControlItem type={AccessMode.EXTERNAL_MEMBERS}>
            <div className="flex items-center p-3">
              <div className="flex grow items-center gap-x-2">
                <RiVerifiedBadgeLine className="size-4 text-text-primary" />
                <p className="system-sm-medium text-text-primary">
                  {t(($) => $['accessControlDialog.accessItems.external'], { ns: 'app' })}
                </p>
              </div>
              {!hideTip && <WebAppSSONotEnabledTip />}
            </div>
          </AccessControlItem>
          <AccessControlItem type={AccessMode.PUBLIC}>
            <div className="flex items-center gap-x-2 p-3">
              <RiGlobalLine className="size-4 text-text-primary" />
              <p className="system-sm-medium text-text-primary">
                {t(($) => $['accessControlDialog.accessItems.anyone'], { ns: 'app' })}
              </p>
            </div>
          </AccessControlItem>
        </RadioGroup>
        <div className="flex items-center justify-end gap-x-2 p-6 pt-5">
          <Button onClick={onClose}>{t(($) => $['operation.cancel'], { ns: 'common' })}</Button>
          <Button
            disabled={isPending}
            loading={isPending}
            variant="primary"
            onClick={handleConfirm}
          >
            {t(($) => $['operation.confirm'], { ns: 'common' })}
          </Button>
        </div>
      </div>
    </AccessControlDialog>
  )
}
