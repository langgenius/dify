import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import Operation from '../operation'

function PinOwner({ restricted = false }: { restricted?: boolean }) {
  const [pinned, setPinned] = useState(false)
  return (
    <Operation
      isPinned={pinned}
      togglePin={() => setPinned((value) => !value)}
      isShowRenameConversation={!restricted}
      isShowDelete={!restricted}
      onDelete={() => {}}
    />
  )
}

beforeEach(async () => {
  await page.viewport(400, 400)
})

it('updates the pin action after each native keyboard selection', async () => {
  await render(<PinOwner />)
  const more = page.getByRole('button', { name: 'common.operation.more' })
  const menu = page.getByRole('menu')
  await userEvent.tab()
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(menu).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.unpin' }))
    .toBeVisible()
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.unpin' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(menu).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toBeVisible()
})

it('excludes unavailable rename and delete actions from keyboard navigation', async () => {
  await render(<PinOwner restricted />)
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('menu')).toBeVisible()
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.rename' }))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.delete' }))
    .not.toBeInTheDocument()
  await userEvent.keyboard('{End}')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.pin' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect.element(page.getByRole('button', { name: 'common.operation.more' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('menuitem', { name: 'explore.sidebar.action.unpin' }))
    .toBeVisible()
})
