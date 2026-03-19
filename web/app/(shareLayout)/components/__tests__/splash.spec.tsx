import { render, screen, waitFor } from '@testing-library/react'
import Splash from '../splash'

const mockReplace = vi.fn()
const mockWebAppLoginStatus = vi.fn()
const mockFetchAccessToken = vi.fn()
const mockSetWebAppAccessToken = vi.fn()
const mockSetWebAppPassport = vi.fn()
const mockWebAppLogout = vi.fn()

let mockShareCode: string | null = null
let mockEmbeddedUserId: string | null = null
let mockMessage: string | null = null
let mockRedirectUrl: string | null = '/chat/test-share-code'
let mockCode: string | null = null
let mockTokenFromUrl: string | null = null

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: { shareCode: string | null, embeddedUserId: string | null }) => unknown) =>
    selector({
      shareCode: mockShareCode,
      embeddedUserId: mockEmbeddedUserId,
    }),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
  useSearchParams: () => ({
    get: (key: string) => {
      if (key === 'redirect_url')
        return mockRedirectUrl
      if (key === 'message')
        return mockMessage
      if (key === 'code')
        return mockCode
      if (key === 'web_sso_token')
        return mockTokenFromUrl
      return null
    },
    toString: () => {
      const params = new URLSearchParams()
      if (mockRedirectUrl)
        params.set('redirect_url', mockRedirectUrl)
      if (mockMessage)
        params.set('message', mockMessage)
      if (mockCode)
        params.set('code', mockCode)
      if (mockTokenFromUrl)
        params.set('web_sso_token', mockTokenFromUrl)
      return params.toString()
    },
    * [Symbol.iterator]() {
      const params = new URLSearchParams(this.toString())
      yield* params.entries()
    },
  }),
}))

vi.mock('@/service/share', () => ({
  fetchAccessToken: (...args: unknown[]) => mockFetchAccessToken(...args),
}))

vi.mock('@/service/webapp-auth', () => ({
  setWebAppAccessToken: (...args: unknown[]) => mockSetWebAppAccessToken(...args),
  setWebAppPassport: (...args: unknown[]) => mockSetWebAppPassport(...args),
  webAppLoginStatus: (...args: unknown[]) => mockWebAppLoginStatus(...args),
  webAppLogout: (...args: unknown[]) => mockWebAppLogout(...args),
}))

describe('Share Splash', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockShareCode = null
    mockEmbeddedUserId = null
    mockMessage = null
    mockRedirectUrl = '/chat/test-share-code'
    mockCode = null
    mockTokenFromUrl = null
    mockWebAppLoginStatus.mockResolvedValue({
      userLoggedIn: true,
      appLoggedIn: true,
    })
    mockFetchAccessToken.mockResolvedValue({ access_token: 'token' })
  })

  describe('Share Code Guard', () => {
    it('should skip login-status checks until the share code is available', async () => {
      render(
        <Splash>
          <div>share child</div>
        </Splash>,
      )

      expect(screen.getByText('share child')).toBeInTheDocument()
      await waitFor(() => {
        expect(mockWebAppLoginStatus).not.toHaveBeenCalled()
      })
      expect(mockFetchAccessToken).not.toHaveBeenCalled()
    })

    it('should resume the auth flow after the share code becomes available', async () => {
      const { rerender } = render(
        <Splash>
          <div>share child</div>
        </Splash>,
      )

      mockShareCode = 'share-code'
      rerender(
        <Splash>
          <div>share child</div>
        </Splash>,
      )

      await waitFor(() => {
        expect(mockWebAppLoginStatus).toHaveBeenCalledWith('share-code', undefined)
      })
      expect(mockReplace).toHaveBeenCalledWith('/chat/test-share-code')
    })
  })
})
