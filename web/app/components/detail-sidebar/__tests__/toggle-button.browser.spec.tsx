import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { DetailSidebarToggleButton } from '../toggle-button'

function ToggleOwner() {
  const [expanded, setExpanded] = useState(true)
  return (
    <DetailSidebarToggleButton expand={expanded} onToggle={() => setExpanded((value) => !value)} />
  )
}

it('keeps keyboard focus while naming and applying the next sidebar action', async () => {
  const screen = await render(<ToggleOwner />)
  const collapse = screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' })
  await userEvent.tab()
  await expect.element(collapse).toHaveFocus()

  await userEvent.keyboard('{Enter}')
  const expand = screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' })
  await expect.element(expand).toHaveFocus()

  await userEvent.keyboard('{Space}')
  await expect
    .element(screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))
    .toHaveFocus()
})
