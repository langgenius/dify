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

  it('uses the existing feature-preview product gate', async () => {
    const { isContactsImPlatformEnabled } = await import('../feature-flag')

    expect(isContactsImPlatformEnabled()).toBe(false)

    featurePreviewEnabled = true

    expect(isContactsImPlatformEnabled()).toBe(true)
  })
})
