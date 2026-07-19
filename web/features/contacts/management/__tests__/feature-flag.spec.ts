let featurePreviewEnabled = false

vi.mock('@/config', () => ({
  get ENABLE_FEATURE_PREVIEW() {
    return featurePreviewEnabled
  },
}))

describe('Contacts management feature flag', () => {
  beforeEach(() => {
    featurePreviewEnabled = false
  })

  it('keeps the mock-backed route behind the preview gate', async () => {
    const { isContactsManagementEnabled } = await import('../feature-flag')

    expect(isContactsManagementEnabled()).toBe(false)
    featurePreviewEnabled = true
    expect(isContactsManagementEnabled()).toBe(true)
  })
})
