'use client'
import type { Subject } from '@/models/access-control'
import type { App } from '@/types/app'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessMode, SubjectType } from '@/models/access-control'
import { useUpdateAccessMode } from '@/service/access-control'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import useAccessControlStore from '../../../../context/access-control-store'
import AccessControlDialog from './access-control-dialog'
import { AccessControlDialogContent } from './access-control-dialog-content'

type AccessControlProps = {
  app: App
  onClose: () => void
  onConfirm?: () => void
}

export default function AccessControl(props: AccessControlProps) {
  const { app, onClose, onConfirm } = props
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const setAppId = useAccessControlStore(s => s.setAppId)
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const setCurrentMenu = useAccessControlStore(s => s.setCurrentMenu)
  const hideExternalTip = systemFeatures.webapp_auth.enabled
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
    toast.success(t('accessControlDialog.updateSuccess', { ns: 'app' }))
    onConfirm?.()
  }, [updateAccessMode, app, specificGroups, specificMembers, t, onConfirm, currentMenu])
  return (
    <AccessControlDialog show onClose={onClose}>
      <AccessControlDialogContent
        hideExternalTip={hideExternalTip}
        saving={isPending}
        onClose={onClose}
        onConfirm={handleConfirm}
      />
    </AccessControlDialog>
  )
}
