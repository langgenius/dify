import type {
  AccessControlAccount,
  AccessControlGroup,
  Subject,
  SubjectAccount,
  SubjectGroup,
} from '@/models/access-control'
import { SubjectType } from '@/models/access-control'

export function groupToSubject(group: AccessControlGroup): SubjectGroup {
  return {
    subjectId: group.id,
    subjectType: SubjectType.GROUP,
    groupData: group,
  }
}

export function memberToSubject(member: AccessControlAccount): SubjectAccount {
  return {
    subjectId: member.id,
    subjectType: SubjectType.ACCOUNT,
    accountData: member,
  }
}

export function getSubjectLabel(subject: Subject) {
  if (subject.subjectType === SubjectType.GROUP)
    return (subject as SubjectGroup).groupData.name

  return (subject as SubjectAccount).accountData.name
}

export function getSubjectValue(subject: Subject) {
  return `${subject.subjectType}:${subject.subjectId}`
}

export function isSameSubject(item: Subject, value: Subject) {
  return item.subjectId === value.subjectId && item.subjectType === value.subjectType
}
