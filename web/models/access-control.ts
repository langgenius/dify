export const SubjectType = {
  GROUP: 'group',
  ACCOUNT: 'account',
} as const

// eslint-disable-next-line ts/no-redeclare -- value-type pair
export type SubjectType = typeof SubjectType[keyof typeof SubjectType]

export const AccessMode = {
  PUBLIC: 'public',
  SPECIFIC_GROUPS_MEMBERS: 'private',
  ORGANIZATION: 'private_all',
  EXTERNAL_MEMBERS: 'sso_verified',
} as const

// eslint-disable-next-line ts/no-redeclare -- value-type pair
export type AccessMode = typeof AccessMode[keyof typeof AccessMode]

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

export type SubjectGroup = { subjectId: string, subjectType: SubjectType, groupData: AccessControlGroup }
export type SubjectAccount = { subjectId: string, subjectType: SubjectType, accountData: AccessControlAccount }

export type Subject = SubjectGroup | SubjectAccount
