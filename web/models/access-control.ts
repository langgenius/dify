export enum SubjectType {
  Group = 'group',
  Account = 'account',
}

export enum AccessMode {
  PUBLIC = 'PUBLIC',
  SPECIFIC_GROUPS_MEMBERS = 'SPECIFIC_GROUPS_MEMBERS',
  ORGANIZATION = 'ORGANIZATION',
}

export type AccessControlGroup = {
  'id': 'string'
  'name': 'string'
  'groupSize': 5
}

export type AccessControlAccount = {
  'id': 'string'
  'name': 'string'
  'email': 'string'
  'avatar': 'string'
  'avatarUrl': 'string'
}

export type SubjectGroup = { subjectId: string; subjectType: SubjectType; groupData: AccessControlGroup }
export type SubjectAccount = { subjectId: string; subjectType: SubjectType; accountData: AccessControlAccount }

export type Subject = SubjectGroup | SubjectAccount
