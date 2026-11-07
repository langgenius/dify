import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DetailSidebarToggleButton } from '../toggle-button'

it('names the next sidebar action and invokes it in either state', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const { rerender } = render(<DetailSidebarToggleButton expand onToggle={onToggle} />)

  await user.click(screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))
  expect(onToggle).toHaveBeenCalledOnce()
  rerender(<DetailSidebarToggleButton expand={false} onToggle={onToggle} />)
  await user.click(screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' }))
  expect(onToggle).toHaveBeenCalledTimes(2)
})
