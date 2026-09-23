import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import { ResponsiveMainNav } from '../responsive-main-nav'

vi.mock('../index', () => ({
  MainNav: () => <div data-testid="main-nav-content">Navigation content</div>,
}))

describe('ResponsiveMainNav', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setCompactViewport = (matches: boolean) => {
    vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
      matches,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  }

  it('keeps navigation inline on wide screens', () => {
    setCompactViewport(false)
    render(<ResponsiveMainNav />)

    expect(screen.getByTestId('main-nav-content')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('makes navigation available in a dismissible drawer on narrow screens', async () => {
    setCompactViewport(true)
    const user = userEvent.setup()
    render(<ResponsiveMainNav />)

    expect(screen.queryByTestId('main-nav-content')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /navigation\.primary/ }))

    const drawer = await screen.findByRole('dialog', { name: /navigation\.primary/ })
    expect(within(drawer).getByTestId('main-nav-content')).toBeInTheDocument()
    await user.click(within(drawer).getByRole('button', { name: /operation\.close/ }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /navigation\.primary/ })).toBeInTheDocument()
  })
})
