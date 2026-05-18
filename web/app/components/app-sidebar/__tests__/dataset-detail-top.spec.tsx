import { fireEvent, render, screen } from '@testing-library/react'
import { GOTO_ANYTHING_OPEN_EVENT } from '@/app/components/goto-anything/hooks'
import DatasetDetailTop from '../dataset-detail-top'

const mockBack = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    back: mockBack,
  }),
}))

describe('DatasetDetailTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('links the home icon to home and labels the breadcrumb as datasets', () => {
    render(<DatasetDetailTop />)

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.getByText('common.menus.datasets')).toBeInTheDocument()
  })

  it('keeps the back button and quick search actions', () => {
    const handleOpen = vi.fn()
    window.addEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)

    render(<DatasetDetailTop />)
    fireEvent.click(screen.getByRole('button', { name: 'common.operation.back' }))
    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(mockBack).toHaveBeenCalledTimes(1)
    expect(handleOpen).toHaveBeenCalledTimes(1)

    window.removeEventListener(GOTO_ANYTHING_OPEN_EVENT, handleOpen)
  })
})
