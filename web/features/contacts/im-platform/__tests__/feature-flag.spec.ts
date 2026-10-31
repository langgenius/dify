const flags = vi.hoisted(() => ({ hitlIm: false, preview: true }))

vi.mock('@/config', () => ({
  get ENABLE_HITL_IM() {
    return flags.hitlIm
  },
  get ENABLE_FEATURE_PREVIEW() {
    return flags.preview
  },
}))

describe('Contacts IM platform release gate', () => {
  it.each([
    [false, false, false],
    [false, false, true],
    [false, true, false],
    [false, true, true],
    [true, false, false],
    [true, false, true],
    [true, true, false],
    [true, true, true],
  ])(
    'gates workspace channels for enabled=%s, centrallyManaged=%s, preview=%s',
    async (hitlIm, managed, preview) => {
      flags.hitlIm = hitlIm
      flags.preview = preview
      const { isContactsImPlatformEnabled } = await import('../feature-flag')
      expect(isContactsImPlatformEnabled(managed)).toBe(hitlIm && !managed)
    },
  )
})
