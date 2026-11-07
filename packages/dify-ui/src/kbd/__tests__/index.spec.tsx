import { render } from 'vitest-browser-react'
import { Kbd, KbdGroup } from '../index'

describe('Kbd', () => {
  it('renders a native kbd element with the default gray variant', async () => {
    const screen = await render(<Kbd>⌘</Kbd>)
    const key = screen.getByText('⌘').element()

    expect(key.tagName).toBe('KBD')
  })

  it('marks disabled keycaps visually without adding widget semantics', async () => {
    const screen = await render(<Kbd disabled>⌘</Kbd>)

    await expect.element(screen.getByText('⌘')).toHaveAttribute('data-disabled')
    await expect.element(screen.getByText('⌘')).not.toHaveAttribute('aria-disabled')
  })
})

describe('KbdGroup', () => {
  it('groups keycaps without replacing individual kbd semantics', async () => {
    const screen = await render(
      <KbdGroup aria-label="Command Shift K">
        <Kbd>⌘</Kbd>
        <Kbd>⇧</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>,
    )

    const group = screen.getByLabelText('Command Shift K').element()
    expect(group.tagName).toBe('SPAN')
    expect(group.querySelectorAll('kbd')).toHaveLength(3)
  })
})
