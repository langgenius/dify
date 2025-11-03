export enum SubjectType {
  GROUP = 'group',
  ACCOUNT = 'account',
}

export enum AccessMode {
  PUBLIC = 'public',
  SPECIFIC_GROUPS_MEMBERS = 'private',
  ORGANIZATION = 'private_all',
  EXTERNAL_MEMBERS = 'sso_verified',
}

export type AccessControlGroup = {
  id: 'string'
  name: 'string'
  groupSize: 5
}

export type AccessControlAccount = {
  id: 'string'
  name: 'string'
  email: 'string'
  avatar: 'string'
  avatarUrl: 'string'
}

export type SubjectGroup = { subjectId: string; subjectType: SubjectType; groupData: AccessControlGroup }
export type SubjectAccount = { subjectId: string; subjectType: SubjectType; accountData: AccessControlAccount }

export type Subject = SubjectGroup | SubjectAccount
