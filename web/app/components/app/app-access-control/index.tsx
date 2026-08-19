'use client'

import type { AppPartial } from '@dify/contracts/api/console/apps/types.gen'
import type {
  AccessControlSubjects,
  AccessControlSubjectsStatus,
} from './specific-groups-or-members'
import type { Subject } from '@/models/access-control'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode, isAccessMode, SubjectType } from '@/models/access-control'
import { useAppWhiteListSubjects } from '@/service/access-control'
import { consoleQuery } from '@/service/client'
import { AccessControlForm } from './access-control-form'

const EMPTY_SUBJECTS: AccessControlSubjects = {
  groups: [],
  members: [],
}

type AccessControlProps = {
  app: Pick<AppPartial, 'id' | 'access_mode'>
  onClose: () => void
  onConfirm?: () => void
}

export default function AccessControl(props: AccessControlProps) {
  return <AppAccessControlContainer key={props.app.id} {...props} />
}

function AppAccessControlContainer({ app, onClose, onConfirm }: AccessControlProps) {
  const { t } = useTranslation()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const [accessMode, setAccessMode] = useState(
    () =>
      (isAccessMode(app.access_mode) ? app.access_mode : undefined) ??
      AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )
  const [subjectsDraft, setSubjectsDraft] = useState<AccessControlSubjects>()
  const subjectsQuery = useAppWhiteListSubjects(
    app.id,
    accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  )
  const subjects = subjectsDraft ?? subjectsQuery.data ?? EMPTY_SUBJECTS
  const subjectsStatus: AccessControlSubjectsStatus =
    subjectsDraft || subjectsQuery.data
      ? 'success'
      : subjectsQuery.isFetching || subjectsQuery.isPending
        ? 'loading'
        : subjectsQuery.isError
          ? 'error'
          : 'loading'
  const updateAccessModeMutation = useMutation(
    consoleQuery.enterprise.webAppAuth.updateWebAppWhitelistSubjects.mutationOptions(),
  )
  const externalMembersTipHidden =
    systemFeatures.webapp_auth.enabled &&
    (systemFeatures.webapp_auth.allow_sso ||
      systemFeatures.webapp_auth.allow_email_password_login ||
      systemFeatures.webapp_auth.allow_email_code_login)
  const publicAccessDisabled = !systemFeatures.webapp_auth.allow_public_access

  const handleConfirm = async () => {
    if (
      updateAccessModeMutation.isPending ||
      (accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS && subjectsStatus !== 'success') ||
      (accessMode === AccessMode.PUBLIC && publicAccessDisabled)
    )
      return

    const submitData: {
      accessMode: AccessMode
      subjects?: Pick<Subject, 'subjectId' | 'subjectType'>[]
    } = { accessMode }

    if (accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS) {
      submitData.subjects = [
        ...subjects.groups.map((group) => ({
          subjectId: group.id,
          subjectType: SubjectType.GROUP,
        })),
        ...subjects.members.map((member) => ({
          subjectId: member.id,
          subjectType: SubjectType.ACCOUNT,
        })),
      ]
    }

    await updateAccessModeMutation.mutateAsync({ body: { appId: app.id, ...submitData } })
    toast.success(t(($) => $['accessControlDialog.updateSuccess'], { ns: 'app' }))
    onConfirm?.()
  }

  return (
    <AccessControlForm
      accessMode={accessMode}
      subjects={subjects}
      subjectsStatus={subjectsStatus}
      updatePending={updateAccessModeMutation.isPending}
      publicAccessDisabled={publicAccessDisabled}
      externalMembersTipHidden={externalMembersTipHidden}
      onAccessModeChange={setAccessMode}
      onSubjectsChange={setSubjectsDraft}
      onRetrySubjects={() => void subjectsQuery.refetch()}
      onClose={onClose}
      onConfirm={() => void handleConfirm()}
    />
  )
}
