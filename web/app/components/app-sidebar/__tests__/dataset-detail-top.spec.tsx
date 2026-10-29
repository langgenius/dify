import { Dialog, DialogPopup, DialogPortal, DialogTitle } from '@langgenius/dify-ui/dialog'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/dialog-handle'
import { DatasetDetailTop } from '../dataset-detail-top'

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
    gotoAnythingDialogHandle.close()
  })

  it('links the combined home control to home and labels the breadcrumb as datasets', () => {
    render(<DatasetDetailTop />)

    expect(screen.getByRole('link', { name: 'navigation.mainNav.home' })).toHaveAttribute(
      'href',
      '/',
    )
    expect(screen.getByRole('link', { name: 'navigation.menus.datasets' })).toHaveAttribute(
      'href',
      '/datasets',
    )
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })

  it('opens quick search from the dataset sidebar', async () => {
    const user = userEvent.setup()
    render(
      <>
        <DatasetDetailTop />
        <TestGotoAnythingDialog />
      </>,
    )
    expect(screen.queryByRole('dialog', { name: 'Goto Anything' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(await screen.findByRole('dialog', { name: 'Goto Anything' })).toBeInTheDocument()
  })

  it('offers expansion when the sidebar is collapsed', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(<DatasetDetailTop expand={false} onToggle={onToggle} />)
    await user.click(screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
