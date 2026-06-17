'use client'
import type { Subject as EnterpriseSubject } from '@dify/contracts/enterprise/types.gen'
import type { App } from '@/types/app'
import { SubjectType as EnterpriseSubjectType } from '@dify/contracts/enterprise/types.gen'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control'
import { consoleQuery } from '@/service/client'
import { AccessControlDialog } from './access-control-dialog'
import { AccessControlDialogContent } from './access-control-dialog-content'
import { useAccessControlStore } from './store'
import { AccessControlDraftProvider } from './store-provider'

type AccessControlProps = {
  app: App
  onClose: () => void
  onConfirm?: () => void
}

export function AccessControl(props: AccessControlProps) {
  const { app, onClose, onConfirm } = props
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const hideExternalTip = systemFeatures.webapp_auth.enabled
    && (systemFeatures.webapp_auth.allow_sso
      || systemFeatures.webapp_auth.allow_email_password_login
      || systemFeatures.webapp_auth.allow_email_code_login)
  const initialAccessMode = app.access_mode ?? AccessMode.SPECIFIC_GROUPS_MEMBERS
  const whiteListSubjectsQuery = useAppWhiteListSubjects(
    app.id,
    initialAccessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )
  const initialSpecificGroups = whiteListSubjectsQuery.data?.groups ?? []
  const initialSpecificMembers = whiteListSubjectsQuery.data?.members ?? []
  const draftKey = [
    app.id,
    initialAccessMode,
    initialSpecificGroups.map(group => group.id).join(','),
    initialSpecificMembers.map(member => member.id).join(','),
  ].join(':')

  return (
    <AccessControlDraftProvider
      draftKey={draftKey}
      initialDraft={{
        appId: app.id,
        currentMenu: initialAccessMode,
        specificGroups: initialSpecificGroups,
        specificMembers: initialSpecificMembers,
        selectedGroupsForBreadcrumb: [],
      }}
    >
      <AccessControlForm
        app={app}
        hideExternalTip={hideExternalTip}
        subjectsLoading={initialAccessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS && whiteListSubjectsQuery.isPending}
        onClose={onClose}
        onConfirm={onConfirm}
        successMessage={t('accessControlDialog.updateSuccess', { ns: 'app' })}
      />
    </AccessControlDraftProvider>
  )
}

function AccessControlForm({
  app,
  hideExternalTip,
  subjectsLoading,
  successMessage,
  onClose,
  onConfirm,
}: {
  app: App
  hideExternalTip: boolean
  subjectsLoading: boolean
  successMessage: string
  onClose: () => void
  onConfirm?: () => void
}) {
  const specificGroups = useAccessControlStore(s => s.specificGroups)
  const specificMembers = useAccessControlStore(s => s.specificMembers)
  const currentMenu = useAccessControlStore(s => s.currentMenu)
  const { isPending, mutate: updateAccessMode } = useMutation(consoleQuery.explore.updateAppAccessMode.mutationOptions())

  function handleConfirm() {
    const submitData: {
      appId: string
      accessMode: AccessMode
      subjects?: Pick<EnterpriseSubject, 'subjectId' | 'subjectType'>[]
    } = { appId: app.id, accessMode: currentMenu }
    if (currentMenu === AccessMode.SPECIFIC_GROUPS_MEMBERS) {
      const subjects: Pick<EnterpriseSubject, 'subjectId' | 'subjectType'>[] = []
      specificGroups.forEach((group) => {
        subjects.push({ subjectId: group.id, subjectType: EnterpriseSubjectType.SUBJECT_TYPE_GROUP })
      })
      specificMembers.forEach((member) => {
        subjects.push({
          subjectId: member.id,
          subjectType: EnterpriseSubjectType.SUBJECT_TYPE_ACCOUNT,
        })
      })
      submitData.subjects = subjects
    }
    updateAccessMode({
      body: submitData,
    }, {
      onSuccess: () => {
        toast.success(successMessage)
        onConfirm?.()
      },
    })
  }

  return (
    <AccessControlDialog show onClose={onClose}>
      <AccessControlDialogContent
        hideExternalTip={hideExternalTip}
        saving={isPending}
        controlsDisabled={subjectsLoading || isPending}
        confirmDisabled={subjectsLoading}
        specificGroupsOrMembersProps={{
          loading: subjectsLoading,
        }}
        onClose={onClose}
        onConfirm={handleConfirm}
      />
    </AccessControlDialog>
  )
}
