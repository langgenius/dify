import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DetailSidebarToggleButton } from '../toggle-button'

describe('DetailSidebarToggleButton', () => {
  it('labels the expanded sidebar action', () => {
    render(<DetailSidebarToggleButton expand onToggle={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }),
    ).toBeInTheDocument()
  })

  it('labels the collapsed sidebar action', () => {
    render(<DetailSidebarToggleButton expand={false} onToggle={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' })).toBeInTheDocument()
  })

  it('toggles the sidebar when activated', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<DetailSidebarToggleButton expand onToggle={onToggle} />)

    await user.click(screen.getByRole('button', { name: 'layout.sidebar.collapseSidebar' }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
