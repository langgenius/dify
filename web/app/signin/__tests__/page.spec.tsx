import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SignIn from '../page'

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
    document.title = ''
    navigationMocks.searchParams = new URLSearchParams()
  })

  it('identifies the sign-in page in the document title', () => {
    render(<SignIn />)

    expect(document.title).toBe('login.signBtn - Dify')
  })

  it('identifies the additional setup step in the document title', () => {
    navigationMocks.searchParams = new URLSearchParams({ step: 'next' })

    render(<SignIn />)

    expect(document.title).toBe('login.oneMoreStep - Dify')
  })
})
