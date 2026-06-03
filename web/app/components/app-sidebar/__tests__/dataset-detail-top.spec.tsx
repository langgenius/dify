import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { useGotoAnythingOpen } from '@/app/components/goto-anything/atoms'
import DatasetDetailTop from '../dataset-detail-top'

const mockBack = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    back: mockBack,
  }),
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

describe('DatasetDetailTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links the home icon to home and labels the breadcrumb as datasets', () => {
    renderWithGotoAnythingStore(<DatasetDetailTop />)

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.getByText('common.menus.datasets')).toBeInTheDocument()
  })

  it('keeps the back button and quick search actions', () => {
    renderWithGotoAnythingStore(
      <>
        <DatasetDetailTop />
        <GotoAnythingOpenProbe />
      </>,
    )
    expect(screen.getByTestId('goto-anything-open')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.back' }))
    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('goto-anything-open')).toHaveTextContent('true')
  })
})
