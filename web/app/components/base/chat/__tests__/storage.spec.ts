import { getChatInputDraft, setChatInputDraft } from '../storage'

const mockStorageFailure = (method: 'getItem' | 'setItem' | 'removeItem', error: DOMException) => {
  const storage = window.sessionStorage
  const fail = vi.fn(() => {
    throw error
  })
  vi.spyOn(window, 'sessionStorage', 'get').mockReturnValue(
    new Proxy(storage, {
      get: (target, property) => (property === method ? fail : Reflect.get(target, property)),
    }),
  )
}

describe('chat input draft storage', () => {
  const draftKey = 'chat-input-draft:conversation-1'
  const draft = '  Unsent message\nwith another line  '

  beforeEach(() => {
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.sessionStorage.clear()
  })

  it('returns an empty draft when no draft is stored', () => {
    expect(getChatInputDraft(draftKey)).toBe('')
  })

  it('saves and restores the exact draft text', () => {
    setChatInputDraft(draftKey, draft)

    expect(window.sessionStorage.getItem(draftKey)).toBe(draft)
    expect(getChatInputDraft(draftKey)).toBe(draft)
  })

  it('restores a previously stored draft', () => {
    window.sessionStorage.setItem(draftKey, draft)

    expect(getChatInputDraft(draftKey)).toBe(draft)
  })

  it('removes a draft when it is cleared', () => {
    setChatInputDraft(draftKey, draft)

    setChatInputDraft(draftKey, '')

    expect(window.sessionStorage.getItem(draftKey)).toBeNull()
    expect(getChatInputDraft(draftKey)).toBe('')
  })

  it('returns an empty draft and tolerates writes when sessionStorage access is denied', () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access is denied', 'SecurityError')
    })

    expect(getChatInputDraft(draftKey)).toBe('')
    expect(() => setChatInputDraft(draftKey, draft)).not.toThrow()
    expect(() => setChatInputDraft(draftKey, '')).not.toThrow()
  })

  it('returns an empty draft when reading storage throws a SecurityError', () => {
    window.sessionStorage.setItem(draftKey, draft)
    mockStorageFailure('getItem', new DOMException('Storage access is denied', 'SecurityError'))

    expect(getChatInputDraft(draftKey)).toBe('')
  })

  it('preserves the stored draft without throwing when saving exceeds the quota', () => {
    window.sessionStorage.setItem(draftKey, draft)
    mockStorageFailure(
      'setItem',
      new DOMException('Storage quota is exceeded', 'QuotaExceededError'),
    )

    expect(() => setChatInputDraft(draftKey, 'Updated message')).not.toThrow()
    expect(getChatInputDraft(draftKey)).toBe(draft)
  })

  it('preserves the stored draft without throwing when deletion fails', () => {
    window.sessionStorage.setItem(draftKey, draft)
    mockStorageFailure('removeItem', new DOMException('Storage access is denied', 'SecurityError'))

    expect(() => setChatInputDraft(draftKey, '')).not.toThrow()
    expect(getChatInputDraft(draftKey)).toBe(draft)
  })
})
