import { Dialog, DialogPopup, DialogPortal, DialogTitle } from '@langgenius/dify-ui/dialog'
import { fireEvent, render, screen } from '@testing-library/react'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/dialog-handle'
import { AppDetailTop } from '../app-detail-top'

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

describe('AppDetailTop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gotoAnythingDialogHandle.close()
  })

  it('links the combined home control to home', () => {
    render(<AppDetailTop />)

    expect(screen.getByRole('link', { name: 'common.mainNav.home' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('button', { name: 'common.operation.back' })).not.toBeInTheDocument()
  })

  it('links the Studio breadcrumb to the Studio page', () => {
    render(<AppDetailTop />)

    expect(screen.getByRole('link', { name: 'common.menus.apps' })).toHaveAttribute('href', '/apps')
  })

  it('keeps the quick search action', () => {
    render(
      <>
        <AppDetailTop />
        <TestGotoAnythingDialog />
      </>,
    )
    expect(screen.queryByRole('dialog', { name: 'Goto Anything' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' }))

    expect(screen.getByRole('dialog', { name: 'Goto Anything' })).toBeInTheDocument()
  })

  it('renders the sidebar toggle action in the top right', () => {
    const onToggle = vi.fn()

    render(<AppDetailTop onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
