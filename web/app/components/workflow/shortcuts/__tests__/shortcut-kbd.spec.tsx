import { render, screen } from '@testing-library/react'
import { ShortcutKbd } from '../shortcut-kbd'

describe('ShortcutKbd', () => {
  it('renders shortcut chords as separate keycaps with the legacy visual classes', () => {
    const { container } = render(
      <ShortcutKbd
        shortcut="workflow.copy"
        platform="mac"
        bgColor="white"
        textColor="secondary"
        className="ml-2"
      />,
    )

    const wrapper = container.firstElementChild
    expect(wrapper).toHaveClass('flex', 'items-center', 'gap-0.5', 'ml-2')

    const keys = container.querySelectorAll('kbd')
    expect(keys).toHaveLength(2)
    expect(screen.getByText('⌘')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(keys[0]).toHaveClass(
      'h-4',
      'min-w-4',
      'rounded-sm',
      'font-sans',
      'not-italic',
      'system-kbd',
      'capitalize',
      'bg-components-kbd-bg-white',
      'text-text-tertiary',
    )
  })

  it('keeps single-key shortcuts in one keycap', () => {
    const { container } = render(
      <ShortcutKbd shortcut="workflow.delete" platform="windows" />,
    )

    expect(container.querySelectorAll('kbd')).toHaveLength(1)
    expect(screen.getByText('⌦')).toBeInTheDocument()
  })

  it('uses TanStack non-mac modifier labels', () => {
    render(<ShortcutKbd shortcut="workflow.copy" platform="windows" />)

    expect(screen.getByText('Ctrl')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
  })
})
