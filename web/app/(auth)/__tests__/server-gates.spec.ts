import { ORPCError } from '@orpc/client'
import { QueryClient } from '@tanstack/react-query'
import Install from '../install/page'
import SignIn from '../signin/page'

const { redirect, getSetupStatus, getProfile } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`)
  }),
  getSetupStatus: vi.fn(),
  getProfile: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/next/navigation', () => ({ redirect }))
vi.mock('@/app/get-query-client', () => ({ getQueryClient: () => new QueryClient() }))
vi.mock('@/service/console', () => ({ consoleClient: { setup: { get: getSetupStatus } } }))
vi.mock('@/service/console/server', () => ({
  resolveServerConsoleApiPrefix: () => 'http://api.test/console/api',
}))
vi.mock('@/features/account-profile/server', async () => {
  const actual = await vi.importActual<typeof import('@/features/account-profile/server')>(
    '@/features/account-profile/server',
  )
  return {
    redirectForBootstrapError: actual.redirectForBootstrapError,
    serverUserProfileQueryOptions: () => ({
      queryKey: ['profile'],
      queryFn: getProfile,
      retry: false,
    }),
  }
})
vi.mock('@/app/route-metadata', () => ({ getRouteMetadata: vi.fn() }))
vi.mock('../signin/sign-in-page', () => ({ default: () => null }))
vi.mock('../install/installForm', () => ({ default: () => null }))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('install page', () => {
  it('sends a finished instance to sign in', async () => {
    getSetupStatus.mockResolvedValue({ step: 'finished' })

    await expect(Install()).rejects.toThrow('redirect:/signin')
  })

  it('renders the account form while setup has not started', async () => {
    getSetupStatus.mockResolvedValue({ step: 'not_started' })

    await expect(Install()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('lets a failed status check reach the error boundary', async () => {
    const failure = new Error('Bootstrap unavailable')
    getSetupStatus.mockRejectedValue(failure)

    await expect(Install()).rejects.toBe(failure)
    expect(redirect).not.toHaveBeenCalled()
  })
})

describe('sign in page', () => {
  it.each([
    ['not_setup', '/install'],
    ['not_init_validated', '/init'],
  ])('sends a %s instance to %s', async (code, path) => {
    getProfile.mockRejectedValue(new ORPCError(code, { status: 401 }))

    await expect(SignIn()).rejects.toThrow(`redirect:${path}`)
  })

  it.each([
    ['a signed-out visitor', new ORPCError('unauthorized', { status: 401 })],
    ['an unreachable API', new TypeError('fetch failed')],
  ])('renders the page for %s', async (_, failure) => {
    getProfile.mockRejectedValue(failure)

    await expect(SignIn()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('renders the page for a signed-in visitor so the client can redirect', async () => {
    getProfile.mockResolvedValue({ profile: { email: 'admin@example.com' }, meta: {} })

    await expect(SignIn()).resolves.toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('lets other profile failures reach the error boundary', async () => {
    const failure = new ORPCError('internal_error', { status: 500 })
    getProfile.mockRejectedValue(failure)

    await expect(SignIn()).rejects.toBe(failure)
    expect(redirect).not.toHaveBeenCalled()
  })
})
