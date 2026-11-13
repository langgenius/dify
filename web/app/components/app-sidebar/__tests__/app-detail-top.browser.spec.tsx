import { Dialog, DialogPopup, DialogPortal, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useRememberStudioListHref } from '@/app/components/apps/list-navigation-state'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/handles'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
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

function AppSidebarTopOwner() {
  const [expanded, setExpanded] = useState(true)
  return <AppDetailTop expand={expanded} onToggle={() => setExpanded((value) => !value)} />
}

function RememberedStudioTop() {
  useRememberStudioListHref('/apps', '/apps?tag=agent')
  return <AppDetailTop />
}

async function renderTop(ui: React.ReactNode) {
  const queryClient = createTestQueryClient()
  seedCurrentWorkspaceQuery(queryClient, { id: 'workspace-1' })
  return render(<QueryClientTestProvider queryClient={queryClient}>{ui}</QueryClientTestProvider>)
}

describe('AppDetailTop', () => {
  beforeEach(() => {
    gotoAnythingDialogHandle.close()
  })

  it('opens quick search from the app breadcrumb and restores focus on Escape', async () => {
    const screen = await renderTop(
      <>
        <RememberedStudioTop />
        <TestGotoAnythingDialog />
      </>,
    )
    const home = screen.getByRole('link', { name: 'navigation.mainNav.home' })
    const studio = screen.getByRole('link', { name: 'navigation.menus.apps' })
    const search = screen.getByRole('button', { name: 'app.gotoAnything.searchTitle' })
    await expect.element(home).toHaveAttribute('href', '/')
    await expect.element(studio).toHaveAttribute('href', '/apps?tag=agent')

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
    const screen = await renderTop(<AppSidebarTopOwner />)
    await userEvent.click(screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))
    const expand = screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' })
    const retainedFocus = document.activeElement === expand.element()
    await expect
      .element(screen.getByRole('link', { name: 'navigation.menus.apps' }))
      .not.toBeInTheDocument()

    await userEvent.click(expand)
    await expect.element(screen.getByRole('link', { name: 'navigation.menus.apps' })).toBeVisible()
    expect(retainedFocus).toBe(true)
  })
})
