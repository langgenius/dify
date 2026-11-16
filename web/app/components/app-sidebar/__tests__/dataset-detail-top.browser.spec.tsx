import { Dialog, DialogPopup, DialogPortal, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/handles'
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

function DatasetSidebarTopOwner() {
  const [expanded, setExpanded] = useState(true)
  return <DatasetDetailTop expand={expanded} onToggle={() => setExpanded((value) => !value)} />
}

describe('DatasetDetailTop', () => {
  beforeEach(() => {
    gotoAnythingDialogHandle.close()
  })

  it('opens quick search from the dataset breadcrumb and restores focus on Escape', async () => {
    const screen = await render(
      <>
        <DatasetDetailTop />
        <TestGotoAnythingDialog />
      </>,
    )
    const home = screen.getByRole('link', { name: 'navigation.mainNav.home' })
    const datasets = screen.getByRole('link', { name: 'navigation.menus.datasets' })
    const search = screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' })
    await expect.element(home).toHaveAttribute('href', '/')
    await expect.element(datasets).toHaveAttribute('href', '/datasets')

    await userEvent.click(search)
    await expect.element(screen.getByRole('dialog', { name: 'Goto Anything' })).toBeVisible()

    await userEvent.keyboard('{Escape}')
    await expect
      .element(screen.getByRole('dialog', { name: 'Goto Anything' }))
      .not.toBeInTheDocument()
    await expect.element(search).toHaveFocus()
  })

  // TODO(https://github.com/langgenius/dify/issues/45934): collapsing leaves focus on body.
  it.fails('collapses and expands without dropping keyboard focus', async () => {
    const screen = await render(<DatasetSidebarTopOwner />)
    await userEvent.click(screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))
    const expand = screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' })
    const retainedFocus = document.activeElement === expand.element()
    await expect
      .element(screen.getByRole('link', { name: 'navigation.menus.datasets' }))
      .not.toBeInTheDocument()

    await userEvent.click(expand)
    await expect
      .element(screen.getByRole('link', { name: 'navigation.menus.datasets' }))
      .toBeVisible()
    expect(retainedFocus).toBe(true)
  })
})
