import { screen } from '@testing-library/react'
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
