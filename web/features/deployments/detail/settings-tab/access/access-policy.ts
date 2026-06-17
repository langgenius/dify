import type {
  AccessPolicy,
  AccessMode as AccessPolicyMode,
  AccessSubject,
  SubjectType as AccessSubjectType,
  Subject,
} from '@dify/contracts/enterprise/types.gen'
import type { AccessSubjectSelectionValue } from '@/app/components/app/app-access-control/access-subject-selector/types'
import type {
  AccessControlAccount,
  AccessControlGroup,
} from '@/models/access-control'
import {
  AccessMode,
  SubjectType,
} from '@dify/contracts/enterprise/types.gen'
import { AccessMode as AppAccessMode } from '@/models/access-control'

export type AccessPermissionKind = 'organization' | 'specific' | 'anyone'

export const permissionIcon: Record<AccessPermissionKind, string> = {
  organization: 'i-ri-building-line',
  specific: 'i-ri-lock-line',
  anyone: 'i-ri-global-line',
}

export type SelectableAccessSubject = {
  id: string
  subjectType: AccessSubjectType
  name?: string
  memberCount?: number
}

export function accessModeToPermissionKey(mode?: AccessPolicy['mode']): AccessPermissionKind {
  if (mode === AccessMode.ACCESS_MODE_PRIVATE)
    return 'specific'
  if (mode === AccessMode.ACCESS_MODE_PUBLIC)
    return 'anyone'
  return 'organization'
}

export function permissionKeyToAccessMode(key: AccessPermissionKind): AccessPolicyMode {
  if (key === 'organization')
    return AccessMode.ACCESS_MODE_PRIVATE_ALL
  if (key === 'specific')
    return AccessMode.ACCESS_MODE_PRIVATE
  return AccessMode.ACCESS_MODE_PUBLIC
}

export function permissionKeyToAppAccessMode(key: AccessPermissionKind): AppAccessMode {
  if (key === 'organization')
    return AppAccessMode.ORGANIZATION
  if (key === 'specific')
    return AppAccessMode.SPECIFIC_GROUPS_MEMBERS
  return AppAccessMode.PUBLIC
}

export function appAccessModeToPermissionKey(mode: AppAccessMode): AccessPermissionKind {
  if (mode === AppAccessMode.SPECIFIC_GROUPS_MEMBERS)
    return 'specific'
  if (mode === AppAccessMode.PUBLIC)
    return 'anyone'
  return 'organization'
}

export function normalizeResolvedSubject(subject: Subject): SelectableAccessSubject | undefined {
  if (subject.subjectType === SubjectType.SUBJECT_TYPE_GROUP) {
    const id = subject.subjectId || subject.groupData?.id
    if (!id)
      return undefined

    return {
      id,
      subjectType: SubjectType.SUBJECT_TYPE_GROUP,
      name: subject.groupData?.name,
      memberCount: subject.groupData?.groupSize,
    }
  }

  if (subject.subjectType === SubjectType.SUBJECT_TYPE_ACCOUNT) {
    const id = subject.subjectId || subject.accountData?.id
    if (!id)
      return undefined

    return {
      id,
      subjectType: SubjectType.SUBJECT_TYPE_ACCOUNT,
      name: subject.accountData?.name || subject.accountData?.email,
    }
  }

  return undefined
}

function getSubjectLabel(subject: SelectableAccessSubject) {
  return subject.name || subject.id
}

export function policySubjects(subjects: SelectableAccessSubject[]): AccessSubject[] {
  return subjects.map(subject => ({
    subjectId: subject.id,
    subjectType: subject.subjectType,
  }))
}

export function selectedSubjectsFromPolicy(policy?: AccessPolicy, labelSubjects: SelectableAccessSubject[] = []) {
  if (!policy)
    return []

  return policy.subjects
    .map((subject): SelectableAccessSubject => {
      const matchedSubject = labelSubjects.find(labelSubject =>
        labelSubject.id === subject.subjectId && labelSubject.subjectType === subject.subjectType,
      )
      return {
        id: subject.subjectId,
        subjectType: subject.subjectType,
        name: matchedSubject?.name,
        memberCount: matchedSubject?.memberCount,
      }
    })
}

function selectableSubjectToGroup(subject: SelectableAccessSubject): AccessControlGroup {
  return {
    id: subject.id,
    name: getSubjectLabel(subject),
    groupSize: subject.memberCount ?? 0,
  }
}

function selectableSubjectToAccount(subject: SelectableAccessSubject): AccessControlAccount {
  const label = getSubjectLabel(subject)

  return {
    id: subject.id,
    name: label,
    email: label,
    avatar: '',
    avatarUrl: '',
  }
}

export function accessControlSelectionFromSubjects(subjects: SelectableAccessSubject[]): AccessSubjectSelectionValue {
  return {
    groups: subjects
      .filter(subject => subject.subjectType === SubjectType.SUBJECT_TYPE_GROUP)
      .map(selectableSubjectToGroup),
    members: subjects
      .filter(subject => subject.subjectType === SubjectType.SUBJECT_TYPE_ACCOUNT)
      .map(selectableSubjectToAccount),
  }
}

export function subjectsFromAccessControlSelection(value: AccessSubjectSelectionValue): SelectableAccessSubject[] {
  return [
    ...value.groups.map((group): SelectableAccessSubject => ({
      id: group.id,
      subjectType: SubjectType.SUBJECT_TYPE_GROUP,
      name: group.name,
      memberCount: group.groupSize,
    })),
    ...value.members.map((member): SelectableAccessSubject => ({
      id: member.id,
      subjectType: SubjectType.SUBJECT_TYPE_ACCOUNT,
      name: member.name || member.email,
    })),
  ]
}
