import type { NavLinkProps } from '..'
import { useState } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import NavLink from '..'

vi.mock('@/next/navigation', () => ({
  useSelectedLayoutSegment: () => 'overview',
}))

function ButtonOwner() {
  const [activated, setActivated] = useState(false)
  return (
    <>
      <NavLink
        name="Orchestrate"
        iconMap={{ selected: 'selected', normal: 'normal' }}
        onClick={() => setActivated(true)}
      />
      <output>{activated ? 'Orchestrate opened' : 'Idle'}</output>
    </>
  )
}

describe('NavLink', () => {
  const mockProps: NavLinkProps = {
    name: 'Orchestrate',
    href: '/app/123/workflow',
    iconMap: {
      selected: 'i-ri-terminal-window-fill',
      normal: 'i-ri-terminal-window-line',
    },
  }

  it('exposes the selected destination to native keyboard navigation', async () => {
    const screen = await render(<NavLink {...mockProps} href="/app/123/overview" />)
    const link = screen.getByRole('link', { name: 'Orchestrate' })
    await expect.element(link).toHaveAttribute('href', '/app/123/overview')

    await userEvent.tab()
    await expect.element(link).toHaveFocus()
  })

  it('keeps a disabled destination out of the native tab order', async () => {
    const screen = await render(
      <>
        <button type="button">Before</button>
        <NavLink {...mockProps} mode="expand" disabled />
        <button type="button">After</button>
      </>,
    )
    const disabled = screen.getByRole('button', { name: 'Orchestrate' })
    await expect.element(disabled).toBeDisabled()
    await expect.element(screen.getByRole('link')).not.toBeInTheDocument()

    await userEvent.tab()
    await expect.element(screen.getByRole('button', { name: 'Before' })).toHaveFocus()
    await userEvent.tab()
    await expect.element(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('applies a button action through its live owner', async () => {
    const screen = await render(<ButtonOwner />)
    await expect.element(screen.getByText('Idle')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Orchestrate' }))
    await expect.element(screen.getByText('Orchestrate opened')).toBeVisible()
  })
})
