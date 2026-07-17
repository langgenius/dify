let featurePreviewEnabled = false

vi.mock('@/config', () => ({
  get ENABLE_FEATURE_PREVIEW() {
    return featurePreviewEnabled
  },
}))

describe('Contacts IM platform feature flag', () => {
  beforeEach(() => {
    featurePreviewEnabled = false
  })

  it('uses the existing feature-preview product gate for non-enterprise workspaces', async () => {
    const { isContactsImPlatformEnabled } = await import('../feature-flag')

    expect(isContactsImPlatformEnabled(false)).toBe(false)

    featurePreviewEnabled = true

    expect(isContactsImPlatformEnabled(false)).toBe(true)
  })

  it('keeps the entry hidden for enterprise workspaces', async () => {
    featurePreviewEnabled = true
    const { isContactsImPlatformEnabled } = await import('../feature-flag')

    expect(isContactsImPlatformEnabled(true)).toBe(false)
  })
})
