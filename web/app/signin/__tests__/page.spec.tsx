import { screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import SignInPage from '../sign-in-page'

const navigationMocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  request: vi.fn(),
  basePath: '',
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: navigationMocks.request,
}))

vi.mock('@/app/components/base/amplitude/utils', () => ({ resetUser: vi.fn() }))
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return navigationMocks.basePath
  },
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => navigationMocks.searchParams,
}))

vi.mock('../normal-form', () => ({
  default: () => <div>Sign-in form</div>,
}))

vi.mock('../one-more-step', () => ({
  default: () => <div>One more step</div>,
}))

describe('SignIn', () => {
  beforeEach(() => {
    navigationMocks.searchParams = new URLSearchParams()
    navigationMocks.basePath = ''
    navigationMocks.request.mockReset()
    window.history.replaceState({}, '', '/signin')
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows account deletion feedback once after the document replacement', () => {
    const info = vi.spyOn(toast, 'info').mockReturnValue('toast-id')
    window.history.replaceState({}, '', '/signin?account_deleted=true&other=value')
    const view = render(<SignInPage />)
    expect(info).toHaveBeenCalledExactlyOnceWith('accountSettings.account.deleteSuccessTip')
    expect(window.location.search).toBe('?other=value')
    view.unmount()
    render(<SignInPage />)
    expect(info).toHaveBeenCalledOnce()
  })

  it('renders the sign-in form by default', () => {
    render(<SignInPage />)

    expect(screen.getByText('Sign-in form')).toBeInTheDocument()
  })

  it('renders the additional setup step when requested', () => {
    navigationMocks.searchParams = new URLSearchParams({ step: 'next' })

    render(<SignInPage />)

    expect(screen.getByText('One more step')).toBeInTheDocument()
  })

  // Native document replacement would unload the Browser Mode runner. Keep this
  // navigation assertion at the existing happy-dom page boundary.
  it('ends the Console session before showing sign-in and preserves the PKCE return context', async () => {
    const logout = createDeferred<Response>()
    navigationMocks.request.mockReturnValueOnce(logout.promise)
    navigationMocks.basePath = '/console'
    navigationMocks.searchParams = new URLSearchParams({
      is_end_user: '1',
      app_code: 'current-app',
      redirect_url: 'https://apps.example/web/chat/current-app?conversation=existing#turn-2',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
      switch_account: '1',
    })
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    render(
      <StrictMode>
        <SignInPage />
      </StrictMode>,
    )

    expect(await screen.findByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    await vi.waitFor(() => expect(navigationMocks.request).toHaveBeenCalledOnce())
    expect(screen.queryByText('Sign-in form')).not.toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()

    logout.resolve(Response.json({ result: 'success' }))
    const expectedParams = new URLSearchParams(navigationMocks.searchParams)
    expectedParams.delete('switch_account')
    await vi.waitFor(() =>
      expect(replace).toHaveBeenCalledExactlyOnceWith(
        `/console/signin?${expectedParams.toString()}`,
      ),
    )
    expect(screen.queryByText('Sign-in form')).not.toBeInTheDocument()
  })

  it('does not end the Console session without a valid end-user login context', () => {
    navigationMocks.searchParams = new URLSearchParams({ switch_account: '1' })
    render(<SignInPage />)

    expect(screen.getByText('Sign-in form')).toBeInTheDocument()
    expect(navigationMocks.request).not.toHaveBeenCalled()
  })
})
