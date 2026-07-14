import type { ReactNode } from 'react'
import { Dialog, DialogPopup, DialogPortal, DialogTitle } from '@langgenius/dify-ui/dialog'
import { fireEvent, render, screen } from '@testing-library/react'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/dialog-handle'
import DatasetDetailTop from '../dataset-detail-top'

vi.mock('../toggle-button', () => ({
  default: ({
    expand,
    handleToggle,
    icon,
  }: {
    expand: boolean
    handleToggle: () => void
    icon?: ReactNode
  }) => (
    <button
      type="button"
      data-testid="toggle-button"
      data-expand={expand}
      data-has-icon={Boolean(icon)}
      onClick={handleToggle}
    >
      Toggle
    </button>
  ),
}))

function TestGotoAnythingDialog() {
  return (
    <Dialog handle={gotoAnythingDialogHandle}>
      <DialogPortal>
        <DialogPopup>
          <DialogTitle>Goto Anything</DialogTitle>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}

describe('DatasetDetailTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gotoAnythingDialogHandle.close()
  })

  it('links the combined home control to home and labels the breadcrumb as datasets', () => {
    render(<DatasetDetailTop />)

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'common.menus.datasets' })).toHaveAttribute(
      'href',
      '/datasets',
    )
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })

  it('keeps the quick search action', () => {
    render(
      <>
        <DatasetDetailTop />
        <TestGotoAnythingDialog />
      </>,
    )
    expect(screen.queryByRole('dialog', { name: 'Goto Anything' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(screen.getByRole('dialog', { name: 'Goto Anything' })).toBeInTheDocument()
  })

  it('renders the sidebar toggle action in the top right', () => {
    const onToggle = vi.fn()

    render(<DatasetDetailTop expand={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByTestId('toggle-button'))

    expect(screen.getByTestId('toggle-button')).toHaveAttribute('data-expand', 'false')
    expect(screen.getByTestId('toggle-button')).toHaveAttribute('data-has-icon', 'true')
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
