import type { AccessSubjectSelectionValue } from './types'
import type {
  AccessControlAccount,
  AccessControlGroup,
  Subject,
  SubjectAccount,
  SubjectGroup,
} from '@/models/access-control'
import { SubjectType } from '@/models/access-control'

function groupToSubject(group: AccessControlGroup): SubjectGroup {
  return {
    subjectId: group.id,
    subjectType: SubjectType.GROUP,
    groupData: group,
  }
}

function memberToSubject(member: AccessControlAccount): SubjectAccount {
  return {
    subjectId: member.id,
    subjectType: SubjectType.ACCOUNT,
    accountData: member,
  }
}

export function getSubjectLabel(subject: Subject) {
  if (subject.subjectType === SubjectType.GROUP) return (subject as SubjectGroup).groupData.name

  return (subject as SubjectAccount).accountData.name
}

export function getSubjectValue(subject: Subject) {
  return `${subject.subjectType}:${subject.subjectId}`
}

export function isSameSubject(item: Subject, value: Subject) {
  return item.subjectId === value.subjectId && item.subjectType === value.subjectType
}

export function selectionValueToSubjects({ groups, members }: AccessSubjectSelectionValue) {
  return [...groups.map(groupToSubject), ...members.map(memberToSubject)]
}

export function subjectsToSelectionValue(subjects: Subject[]): AccessSubjectSelectionValue {
  const groups: AccessControlGroup[] = []
  const members: AccessControlAccount[] = []

  subjects.forEach((subject) => {
    if (subject.subjectType === SubjectType.GROUP) groups.push((subject as SubjectGroup).groupData)
    else members.push((subject as SubjectAccount).accountData)
  })

  return { groups, members }
}
