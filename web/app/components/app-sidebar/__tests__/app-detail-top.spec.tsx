import { fireEvent, render, screen } from '@testing-library/react'
import { GOTO_ANYTHING_OPEN_EVENT } from '@/app/components/goto-anything/hooks'
import AppDetailTop from '../app-detail-top'

const mockBack = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    back: mockBack,
  }),
}))

vi.mock('../toggle-button', () => ({
  default: ({ expand, handleToggle }: { expand: boolean, handleToggle: () => void }) => (
    <button type="button" data-testid="toggle-button" data-expand={expand} onClick={handleToggle}>
      Toggle
    </button>
  ),
}))

describe('AppDetailTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links the home icon to home instead of studio', () => {
    render(<AppDetailTop />)

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
  })

  it('links the Studio breadcrumb to the Studio page', () => {
    render(<AppDetailTop />)

    expect(screen.getByRole('link', { name: 'common.menus.apps' })).toHaveAttribute('href', '/apps')
  })

  it('keeps the back button and quick search actions', () => {
    const handleOpen = vi.fn()
    window.addEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)

    render(<AppDetailTop />)
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.back' }))
    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(handleOpen).toHaveBeenCalledTimes(1)

    window.removeEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)
  })

  it('renders the sidebar toggle action in the top right', () => {
    const onToggle = vi.fn()

    render(<AppDetailTop expand={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByTestId('toggle-button'))

    expect(screen.getByTestId('toggle-button')).toHaveAttribute('data-expand', 'false')
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
