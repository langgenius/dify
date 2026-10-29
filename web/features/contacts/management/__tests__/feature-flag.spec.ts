const flags = vi.hoisted(() => ({ hitlIm: false, preview: true }))

vi.mock('@/config', () => ({
  get ENABLE_HITL_IM() {
    return flags.hitlIm
  },
  get ENABLE_FEATURE_PREVIEW() {
    return flags.preview
  },
}))

describe('Contacts management release gate', () => {
  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'uses the dedicated gate (%s) independently of feature preview (%s)',
    async (hitlIm, preview) => {
      flags.hitlIm = hitlIm
      flags.preview = preview
      const { isContactsManagementEnabled } = await import('../feature-flag')
      expect(isContactsManagementEnabled()).toBe(hitlIm)
    },
  )
})
