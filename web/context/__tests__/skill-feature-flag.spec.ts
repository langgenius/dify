import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

describe('resolveSkillFeatureFlag', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('stays unknown until a boolean has been observed', async () => {
    const { resolveSkillFeatureFlag } = await import('../skill-feature-flag')
    expect(resolveSkillFeatureFlag(undefined)).toBeUndefined()
  })

  it('keeps the last known enabled flag when the next value is unknown', async () => {
    const { resolveSkillFeatureFlag } = await import('../skill-feature-flag')
    expect(resolveSkillFeatureFlag(true)).toBe(true)
    expect(resolveSkillFeatureFlag(undefined)).toBe(true)
  })

  it('keeps the last known disabled flag when the next value is unknown', async () => {
    const { resolveSkillFeatureFlag } = await import('../skill-feature-flag')
    expect(resolveSkillFeatureFlag(false)).toBe(false)
    expect(resolveSkillFeatureFlag(undefined)).toBe(false)
  })

  it('replaces the last known flag when a new boolean is observed', async () => {
    const { resolveSkillFeatureFlag } = await import('../skill-feature-flag')
    expect(resolveSkillFeatureFlag(true)).toBe(true)
    expect(resolveSkillFeatureFlag(false)).toBe(false)
    expect(resolveSkillFeatureFlag(undefined)).toBe(false)
  })
})
