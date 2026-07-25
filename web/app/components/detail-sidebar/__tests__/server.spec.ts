import { DETAIL_SIDEBAR_COOKIE_NAME } from '../preference'
import { getInitialDetailSidebarMode } from '../server'

const mocks = vi.hoisted(() => ({
  getCookie: vi.fn(),
}))

vi.mock('@/next/headers', () => ({
  cookies: async () => ({ get: mocks.getCookie }),
}))

describe('getInitialDetailSidebarMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads a valid mode from the request Cookie', async () => {
    mocks.getCookie.mockReturnValue({ value: 'collapse' })

    await expect(getInitialDetailSidebarMode()).resolves.toBe('collapse')
    expect(mocks.getCookie).toHaveBeenCalledWith(DETAIL_SIDEBAR_COOKIE_NAME)
  })

  it.each([undefined, { value: 'invalid' }])('uses the default mode for %s', async (cookie) => {
    mocks.getCookie.mockReturnValue(cookie)

    await expect(getInitialDetailSidebarMode()).resolves.toBe('expand')
  })
})
