import { createRequestId } from '../request-id'

const uuidV4Mock = vi.hoisted(() => vi.fn())

vi.mock('uuid', () => ({
  v4: uuidV4Mock,
}))

describe('createRequestId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    uuidV4Mock.mockReturnValue('fallback-request-id')
  })

  it('uses the native random UUID when it is available', () => {
    const randomUUID = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('11111111-1111-4111-8111-111111111111')

    expect(createRequestId()).toBe('11111111-1111-4111-8111-111111111111')
    expect(uuidV4Mock).not.toHaveBeenCalled()

    randomUUID.mockRestore()
  })

  it('falls back when randomUUID is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    })

    try {
      expect(createRequestId()).toBe('fallback-request-id')
      expect(uuidV4Mock).toHaveBeenCalledOnce()
    } finally {
      if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor)
      else Reflect.deleteProperty(globalThis.crypto, 'randomUUID')
    }
  })
})
