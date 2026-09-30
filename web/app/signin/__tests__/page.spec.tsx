import { screen } from '@testing-library/react'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SignInPage from '../sign-in-page'

const navigationMocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
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
    window.history.replaceState({}, '', '/signin')
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
})
