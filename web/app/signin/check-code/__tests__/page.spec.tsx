import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { emailLoginWithCode } from '@/service/common'
import CheckCode from '../page'

const navigationMocks = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))

const serviceBaseMocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  IS_CLOUD_EDITION: true,
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    back: navigationMocks.back,
    replace: navigationMocks.replace,
  }),
  useSearchParams: () => navigationMocks.searchParams,
}))

vi.mock('@/service/base', () => serviceBaseMocks)

vi.mock('@/service/common', () => ({
  emailLoginWithCode: vi.fn(),
  sendEMailLoginCode: vi.fn(),
}))

vi.mock('@/utils/encryption', () => ({
  encryptVerificationCode: (code: string) => code,
}))

vi.mock('@/utils/timezone', () => ({
  getBrowserTimezone: () => 'Asia/Singapore',
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

const accountProfile: GetAccountProfileResponse = {
  avatar: null,
  avatar_url: null,
  created_at: 1_700_000_000,
  email: 'user@example.com',
  id: 'account-id',
  interface_language: 'en-US',
  interface_theme: 'light',
  is_password_set: true,
  last_login_at: 1_700_000_000,
  last_login_ip: '127.0.0.1',
  name: 'User',
  timezone: 'Asia/Singapore',
}

describe('CheckCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.searchParams = new URLSearchParams({
      email: 'user@example.com',
      redirect_url: '/apps',
      token: 'email-login-token',
    })
    vi.mocked(emailLoginWithCode).mockResolvedValue({ result: 'success' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('Post-login profile bootstrap', () => {
    it('should resolve an inactive profile query before navigating to the console home', async () => {
      const user = userEvent.setup()
      const queryClient = createQueryClient()
      const profileQueryOptions = userProfileQueryOptions()
      const profileQueryKey = profileQueryOptions.queryKey
      let resolveProfileResponse: (response: Response) => void = () => {}
      const profileResponse = new Promise<Response>((resolve) => {
        resolveProfileResponse = resolve
      })
      serviceBaseMocks.get
        .mockRejectedValueOnce(new Response(null, { status: 401 }))
        .mockReturnValueOnce(profileResponse)
      await queryClient.prefetchQuery(profileQueryOptions)
      expect(queryClient.getQueryState(profileQueryKey)?.status).toBe('error')

      render(
        <QueryClientProvider client={queryClient}>
          <CheckCode />
        </QueryClientProvider>,
      )

      await user.type(screen.getByLabelText('login.checkCode.verificationCode'), '123456')
      await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))

      await waitFor(() => {
        expect(serviceBaseMocks.get).toHaveBeenCalledTimes(2)
      })
      expect(queryClient.getQueryState(profileQueryKey)).toMatchObject({
        fetchStatus: 'fetching',
        status: 'pending',
      })
      expect(navigationMocks.replace).not.toHaveBeenCalled()

      resolveProfileResponse(
        new Response(JSON.stringify(accountProfile), {
          headers: {
            'content-type': 'application/json',
            'x-env': 'DEVELOPMENT',
            'x-version': '1.0.0',
          },
          status: 200,
        }),
      )

      await waitFor(() => {
        expect(navigationMocks.replace).toHaveBeenCalledWith('/apps')
      })
      expect(queryClient.getQueryState(profileQueryKey)?.status).toBe('success')
    })

    it('should keep a Cloud verification-code login on the current deployment', async () => {
      const user = userEvent.setup()
      const queryClient = createQueryClient()
      const locationReplace = vi.fn()
      navigationMocks.searchParams = new URLSearchParams({
        email: 'hanxujiang%2B4%40dify.ai',
        token: 'email-login-token',
      })
      serviceBaseMocks.get.mockResolvedValue(
        new Response(JSON.stringify(accountProfile), {
          headers: {
            'content-type': 'application/json',
            'x-env': 'DEVELOPMENT',
            'x-version': '1.0.0',
          },
          status: 200,
        }),
      )
      vi.stubGlobal('location', {
        ...window.location,
        origin: 'https://saas.dify.dev',
        replace: locationReplace,
      } as unknown as Location)

      render(
        <QueryClientProvider client={queryClient}>
          <CheckCode />
        </QueryClientProvider>,
      )

      await user.type(screen.getByLabelText('login.checkCode.verificationCode'), '123456')
      await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))

      await waitFor(() => {
        expect(navigationMocks.replace).toHaveBeenCalledWith('/')
      })
      expect(locationReplace).not.toHaveBeenCalled()
    })
  })
})
