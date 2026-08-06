import type { AccessPolicy, Subject } from '@dify/contracts/enterprise/types.gen'
import { AccessMode, AccessSubjectType } from '@dify/contracts/enterprise/types.gen'
import { describe, expect, it } from 'vitest'
import { AccessMode as AppAccessMode, SubjectType } from '@/models/access-control'
import {
  accessControlSelectionFromSubjects,
  accessModeToPermissionKey,
  appAccessModeToPermissionKey,
  normalizeResolvedSubject,
  permissionKeyToAccessMode,
  permissionKeyToAppAccessMode,
  policySubjects,
  selectedSubjectsFromPolicy,
  subjectsFromAccessControlSelection,
} from '../access-policy'

function policy(overrides: Partial<AccessPolicy>): AccessPolicy {
  return {
    id: 'policy-1',
    appInstanceId: 'app-instance-1',
    environmentId: 'environment-1',
    mode: AccessMode.ACCESS_MODE_PRIVATE_ALL,
    subjects: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('access policy mode mapping', () => {
  it('should map API access modes to deployment permission keys', () => {
    expect(accessModeToPermissionKey(AccessMode.ACCESS_MODE_PRIVATE)).toBe('specific')
    expect(accessModeToPermissionKey(AccessMode.ACCESS_MODE_PUBLIC)).toBe('anyone')
    expect(accessModeToPermissionKey(AccessMode.ACCESS_MODE_PRIVATE_ALL)).toBe('organization')
    expect(accessModeToPermissionKey()).toBe('organization')
  })

  it('should map permission keys to API and app access modes', () => {
    expect(permissionKeyToAccessMode('organization')).toBe(AccessMode.ACCESS_MODE_PRIVATE_ALL)
    expect(permissionKeyToAccessMode('specific')).toBe(AccessMode.ACCESS_MODE_PRIVATE)
    expect(permissionKeyToAccessMode('anyone')).toBe(AccessMode.ACCESS_MODE_PUBLIC)

    expect(permissionKeyToAppAccessMode('organization')).toBe(AppAccessMode.ORGANIZATION)
    expect(permissionKeyToAppAccessMode('specific')).toBe(AppAccessMode.SPECIFIC_GROUPS_MEMBERS)
    expect(permissionKeyToAppAccessMode('anyone')).toBe(AppAccessMode.PUBLIC)

    expect(appAccessModeToPermissionKey(AppAccessMode.SPECIFIC_GROUPS_MEMBERS)).toBe('specific')
    expect(appAccessModeToPermissionKey(AppAccessMode.PUBLIC)).toBe('anyone')
    expect(appAccessModeToPermissionKey(AppAccessMode.ORGANIZATION)).toBe('organization')
  })
})

describe('access policy subject conversion', () => {
  it('should normalize resolved group and account subjects', () => {
    expect(
      normalizeResolvedSubject({
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
        groupData: {
          id: 'group-1',
          name: 'Admins',
          groupSize: 3,
        },
      }),
    ).toEqual({
      id: 'group-1',
      subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
      name: 'Admins',
      memberCount: 3,
    })

    expect(
      normalizeResolvedSubject({
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
        accountData: {
          id: 'account-1',
          email: 'member@example.com',
        },
      }),
    ).toEqual({
      id: 'account-1',
      subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
      name: 'member@example.com',
    })
  })

  it('should normalize resolved subjects that use app access-control subject types', () => {
    expect(
      normalizeResolvedSubject({
        subjectId: 'group-1',
        subjectType: SubjectType.GROUP,
        groupData: {
          id: 'group-1',
          name: 'Admins',
          groupSize: 3,
        },
      }),
    ).toEqual({
      id: 'group-1',
      subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
      name: 'Admins',
      memberCount: 3,
    })

    expect(
      normalizeResolvedSubject({
        subjectId: 'account-1',
        subjectType: SubjectType.ACCOUNT,
        accountData: {
          id: 'account-1',
          name: 'Member',
          email: 'member@example.com',
        },
      }),
    ).toEqual({
      id: 'account-1',
      subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
      name: 'Member',
    })
  })

  it('should ignore unsupported subjects and subjects without ids', () => {
    expect(
      normalizeResolvedSubject({ subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP }),
    ).toBeUndefined()
    expect(
      normalizeResolvedSubject({ subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT }),
    ).toBeUndefined()
    expect(
      normalizeResolvedSubject({
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_UNSPECIFIED,
      } as Subject),
    ).toBeUndefined()
  })

  it('should preserve labels when reading selected subjects from policy', () => {
    expect(
      selectedSubjectsFromPolicy(
        policy({
          subjects: [
            { subjectId: 'group-1', subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP },
            { subjectId: 'account-1', subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT },
          ],
        }),
        [
          {
            id: 'group-1',
            subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
            name: 'Admins',
            memberCount: 3,
          },
        ],
      ),
    ).toEqual([
      {
        id: 'group-1',
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
        name: 'Admins',
        memberCount: 3,
      },
      {
        id: 'account-1',
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
      },
    ])

    expect(selectedSubjectsFromPolicy()).toEqual([])
  })

  it('should convert between deployment subjects and access-control selections', () => {
    const subjects = [
      {
        id: 'group-1',
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP,
        name: 'Admins',
        memberCount: 3,
      },
      {
        id: 'account-1',
        subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT,
        name: 'Member',
      },
    ]

    expect(policySubjects(subjects)).toEqual([
      { subjectId: 'group-1', subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_GROUP },
      { subjectId: 'account-1', subjectType: AccessSubjectType.ACCESS_SUBJECT_TYPE_ACCOUNT },
    ])

    const selection = accessControlSelectionFromSubjects(subjects)
    expect(selection.groups).toEqual([
      {
        id: 'group-1',
        name: 'Admins',
        groupSize: 3,
      },
    ])
    expect(selection.members).toEqual([
      {
        id: 'account-1',
        name: 'Member',
        email: 'Member',
        avatar: '',
        avatarUrl: '',
      },
    ])
    expect(subjectsFromAccessControlSelection(selection)).toEqual(subjects)
  })
})
