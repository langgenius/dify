'use client'

import type { EnvironmentWebAppSubject } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type {
  AccessControlSubjects,
  AccessControlSubjectsStatus,
} from '@/app/components/app/app-access-control/specific-groups-or-members'
import type { AccessControlAccount, AccessControlGroup } from '@/models/access-control'
import { toast } from '@langgenius/dify-ui/toast'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessControlForm } from '@/app/components/app/app-access-control/access-control-form'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { AccessMode, SubjectType } from '@/models/access-control'
import { consoleQuery } from '@/service/client'

const EMPTY_SUBJECTS: AccessControlSubjects = {
  groups: [],
  members: [],
}

type EnvironmentAccessControlProps = {
  appId: string
  environmentId: string
  accessMode: AccessMode
  canManage: boolean
  onClose: () => void
  onConfirm: () => void
}

export function EnvironmentAccessControl(props: EnvironmentAccessControlProps) {
  const key = `${props.appId}:${props.environmentId}`
  return <EnvironmentAccessControlContainer key={key} {...props} />
}

function EnvironmentAccessControlContainer({
  appId,
  environmentId,
  accessMode: initialAccessMode,
  canManage,
  onClose,
  onConfirm,
}: EnvironmentAccessControlProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const [accessMode, setAccessMode] = useState<AccessMode>(initialAccessMode)
  const [subjectsDraft, setSubjectsDraft] = useState<AccessControlSubjects>()
  const params = {
    app_id: appId,
    environment_id: environmentId,
  }
  const siteQueryOptions =
    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentSite.queryOptions({
      input: { params },
    })
  const subjectsQueryOptions =
    consoleQuery.enterprise.appDeploy.accessService.getEnvironmentWebAppSubjects.queryOptions({
      input: { params },
    })
  const subjectsQuery = useQuery({
    ...subjectsQueryOptions,
    enabled: accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS,
  })
  const loadedSubjects = subjectsQuery.data
    ? normalizeEnvironmentSubjects(subjectsQuery.data.subjects)
    : undefined
  const subjects = subjectsDraft ?? loadedSubjects ?? EMPTY_SUBJECTS
  const subjectsStatus: AccessControlSubjectsStatus =
    subjectsDraft || loadedSubjects
      ? 'success'
      : subjectsQuery.isFetching || subjectsQuery.isPending
        ? 'loading'
        : subjectsQuery.isError
          ? 'error'
          : 'loading'
  const updateAccessModeMutation = useMutation(
    consoleQuery.enterprise.appDeploy.accessService.updateEnvironmentWebAppAccessMode.mutationOptions(
      {
        onSuccess: (updatedSite) => {
          queryClient.setQueryData(siteQueryOptions.queryKey, updatedSite)
          void queryClient.invalidateQueries({ queryKey: subjectsQueryOptions.queryKey })
        },
        onError: () => {
          toast.error(t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }))
        },
      },
    ),
  )
  const publicAccessDisabled = !systemFeatures.webapp_auth.allow_public_access
  const externalMembersTipHidden =
    systemFeatures.webapp_auth.enabled &&
    (systemFeatures.webapp_auth.allow_sso ||
      systemFeatures.webapp_auth.allow_email_password_login ||
      systemFeatures.webapp_auth.allow_email_code_login)

  const handleConfirm = async () => {
    if (
      !canManage ||
      updateAccessModeMutation.isPending ||
      (accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS && subjectsStatus !== 'success') ||
      (accessMode === AccessMode.PUBLIC && publicAccessDisabled)
    )
      return

    await updateAccessModeMutation.mutateAsync({
      params,
      body: {
        access_mode: accessMode,
        ...(accessMode === AccessMode.SPECIFIC_GROUPS_MEMBERS
          ? {
              subjects: [
                ...subjects.groups.map((group) => ({
                  subject_id: group.id,
                  subject_type: SubjectType.GROUP,
                })),
                ...subjects.members.map((member) => ({
                  subject_id: member.id,
                  subject_type: SubjectType.ACCOUNT,
                })),
              ],
            }
          : {}),
      },
    })
    toast.success(t(($) => $['accessControlDialog.updateSuccess'], { ns: 'app' }))
    onConfirm()
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

function normalizeEnvironmentSubjects(subjects: EnvironmentWebAppSubject[]) {
  const groups: AccessControlGroup[] = []
  const members: AccessControlAccount[] = []

  subjects.forEach((subject) => {
    if (subject.subject_type === SubjectType.GROUP) {
      const id = subject.subject_id || subject.group_data?.id
      const name = subject.group_data?.name
      const groupSize = subject.group_data?.group_size
      if (id && name && groupSize !== undefined) groups.push({ id, name, groupSize })
      return
    }

    if (subject.subject_type === SubjectType.ACCOUNT) {
      const id = subject.subject_id || subject.account_data?.id
      const name = subject.account_data?.name
      const email = subject.account_data?.email
      const avatar = subject.account_data?.avatar ?? ''
      if (id && name && email) members.push({ id, name, email, avatar, avatarUrl: avatar })
    }
  })

  return { groups, members }
}
