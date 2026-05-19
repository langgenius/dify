import { render, screen } from '@testing-library/react'
import ShortcutsName from '../shortcuts-name'

describe('ShortcutsName', () => {
  const originalNavigator = globalThis.navigator

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    })
  })

  it('renders mac-friendly key labels and style variants', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Macintosh' },
      writable: true,
      configurable: true,
    })

    const { container } = render(
      <ShortcutsName
        keys={['ctrl', 'shift', 's']}
        bgColor="white"
        textColor="secondary"
      />,
    )

    expect(screen.getByText('⌘')).toBeInTheDocument()
    expect(screen.getByText('⇧')).toBeInTheDocument()
    expect(screen.getByText('s')).toBeInTheDocument()
    expect(container.querySelector('.system-kbd')).toHaveClass(
      'bg-components-kbd-bg-white',
      'text-text-tertiary',
    )
  })

  it('keeps raw key names on non-mac systems', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Windows NT' },
      writable: true,
      configurable: true,
    })

    render(<ShortcutsName keys={['ctrl', 'alt']} />)

    expect(screen.getByText('ctrl')).toBeInTheDocument()
    expect(screen.getByText('alt')).toBeInTheDocument()
  })
})
