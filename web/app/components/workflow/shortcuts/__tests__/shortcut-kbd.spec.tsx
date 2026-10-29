import { render, screen } from '@testing-library/react'
import { ShortcutKbd } from '../shortcut-kbd'

describe('ShortcutKbd', () => {
  it('renders shortcut chords as separate design-system keycaps', () => {
    const { container } = render(<ShortcutKbd shortcut="workflow.copy" platform="mac" />)

    const keys = container.querySelectorAll('kbd')
    expect(keys).toHaveLength(2)
    expect(screen.getByText('⌘')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })

  it('keeps single-key shortcuts in one keycap', () => {
    const { container } = render(<ShortcutKbd shortcut="workflow.delete" platform="windows" />)

    expect(container.querySelectorAll('kbd')).toHaveLength(1)
    expect(screen.getByText('⌦')).toBeInTheDocument()
  })

  it('uses TanStack non-mac modifier labels', () => {
    render(<ShortcutKbd shortcut="workflow.copy" platform="windows" />)

    expect(screen.getByText('Ctrl')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })
})
