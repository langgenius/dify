import { describe, expect, it } from 'vite-plus/test'
import { getSkillPermissions } from '../permissions'

describe('Skill deletion capabilities', () => {
  it.each([
    [true, 'alice', 'alice', ['skill.edit'], true],
    [true, 'alice', 'alice', [], false],
    [true, 'alice', 'bob', ['skill.edit'], false],
    [true, 'alice', null, ['skill.edit'], false],
    [true, undefined, 'alice', ['skill.edit'], false],
    [true, 'alice', 'alice', undefined, false],
    [true, 'alice', 'bob', ['skill.delete'], true],
    [false, 'alice', 'alice', ['skill.edit'], false],
    [false, 'alice', 'bob', ['skill.delete'], true],
  ] as const)(
    'rbac=%s user=%s maintainer=%s keys=%j => delete=%s',
    (isRbacEnabled, currentUserId, resourceMaintainer, keys, expected) => {
      const capabilities = getSkillPermissions(keys, {
        isRbacEnabled,
        currentUserId,
        resourceMaintainer,
      })
      expect(capabilities.canDelete).toBe(expected)
      expect(capabilities.canView).toBe(false)
      expect(capabilities.canPublish).toBe(false)
      expect(capabilities.canEdit).toBe((keys ?? []).some((key) => key === 'skill.edit'))
    },
  )
})
