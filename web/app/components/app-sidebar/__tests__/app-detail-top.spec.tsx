import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { useGotoAnythingOpen } from '@/app/components/goto-anything/atoms'
import AppDetailTop from '../app-detail-top'

vi.mock('../toggle-button', () => ({
  default: ({ expand, handleToggle }: { expand: boolean, handleToggle: () => void }) => (
    <button type="button" data-testid="toggle-button" data-expand={expand} onClick={handleToggle}>
      Toggle
    </button>
  ),
}))

function GotoAnythingOpenProbe() {
  const open = useGotoAnythingOpen()

  return <div data-testid="goto-anything-open">{String(open)}</div>
}

const renderWithGotoAnythingStore = (ui: ReactNode) => {
  const store = createStore()

  return render(
    <JotaiProvider store={store}>
      {ui}
    </JotaiProvider>,
  )
}

describe('AppDetailTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links the combined home control to home', () => {
    renderWithGotoAnythingStore(<AppDetailTop />)

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })

  it('links the Studio breadcrumb to the Studio page', () => {
    renderWithGotoAnythingStore(<AppDetailTop />)

    expect(screen.getByRole('link', { name: 'common.menus.apps' })).toHaveAttribute('href', '/apps')
  })

  it('keeps the quick search action', () => {
    renderWithGotoAnythingStore(
      <>
        <AppDetailTop />
        <GotoAnythingOpenProbe />
      </>,
    )
    expect(screen.getByTestId('goto-anything-open')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(screen.getByTestId('goto-anything-open')).toHaveTextContent('true')
  })

  it('renders the sidebar toggle action in the top right', () => {
    const onToggle = vi.fn()

    renderWithGotoAnythingStore(<AppDetailTop expand={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByTestId('toggle-button'))

    expect(screen.getByTestId('toggle-button')).toHaveAttribute('data-expand', 'false')
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
