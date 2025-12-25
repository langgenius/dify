import { fireEvent, render, screen } from '@testing-library/react'
import Badge, { BadgeState, BadgeVariants } from './index'

describe('Badge', () => {
  describe('Rendering', () => {
    it('should render as a div element with badge class', () => {
      render(<Badge>Test Badge</Badge>)

      const badge = screen.getByText('Test Badge')
      expect(badge).toHaveClass('badge')
      expect(badge.tagName).toBe('DIV')
    })

    it.each([
      { children: undefined, label: 'no children' },
      { children: '', label: 'empty string' },
    ])('should render correctly when provided $label', ({ children }) => {
      const { container } = render(<Badge>{children}</Badge>)

      expect(container.firstChild).toHaveClass('badge')
    })

    it('should render React Node children correctly', () => {
      render(
        <Badge data-testid="badge-with-icon">
          <span data-testid="custom-icon">🔔</span>
        </Badge>,
      )

      expect(screen.getByTestId('badge-with-icon')).toBeInTheDocument()
      expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
    })
  })

  describe('size prop', () => {
    it.each([
      { size: undefined, label: 'medium (default)' },
      { size: 's', label: 'small' },
      { size: 'm', label: 'medium' },
      { size: 'l', label: 'large' },
    ] as const)('should render with $label size', ({ size }) => {
      render(<Badge size={size}>Test</Badge>)

      const expectedSize = size || 'm'
      expect(screen.getByText('Test')).toHaveClass('badge', `badge-${expectedSize}`)
    })
  })

  describe('state prop', () => {
    it.each([
      { state: BadgeState.Warning, label: 'warning', expectedClass: 'badge-warning' },
      { state: BadgeState.Accent, label: 'accent', expectedClass: 'badge-accent' },
    ])('should render with $label state', ({ state, expectedClass }) => {
      render(<Badge state={state}>State Test</Badge>)

      expect(screen.getByText('State Test')).toHaveClass(expectedClass)
    })

    it.each([
      { state: undefined, label: 'default (undefined)' },
      { state: BadgeState.Default, label: 'default (explicit)' },
    ])('should use default styles when state is $label', ({ state }) => {
      render(<Badge state={state}>State Test</Badge>)

      const badge = screen.getByText('State Test')
      expect(badge).not.toHaveClass('badge-warning', 'badge-accent')
    })
  })

  describe('iconOnly prop', () => {
    it.each([
      { size: 's', iconOnly: false, label: 'small with text' },
      { size: 's', iconOnly: true, label: 'small icon-only' },
      { size: 'm', iconOnly: false, label: 'medium with text' },
      { size: 'm', iconOnly: true, label: 'medium icon-only' },
      { size: 'l', iconOnly: false, label: 'large with text' },
      { size: 'l', iconOnly: true, label: 'large icon-only' },
    ] as const)('should render correctly for $label', ({ size, iconOnly }) => {
      const { container } = render(<Badge size={size} iconOnly={iconOnly}>🔔</Badge>)
      const badge = screen.getByText('🔔')

      // Verify badge renders with correct size
      expect(badge).toHaveClass('badge', `badge-${size}`)

      // Verify the badge is in the DOM and contains the content
      expect(badge).toBeInTheDocument()
      expect(container.firstChild).toBe(badge)
    })

    it('should apply icon-only padding when iconOnly is true', () => {
      render(<Badge iconOnly>🔔</Badge>)

      // When iconOnly is true, the badge should have uniform padding (all sides equal)
      const badge = screen.getByText('🔔')
      expect(badge).toHaveClass('p-1')
    })

    it('should apply asymmetric padding when iconOnly is false', () => {
      render(<Badge iconOnly={false}>Badge</Badge>)

      // When iconOnly is false, the badge should have different horizontal and vertical padding
      const badge = screen.getByText('Badge')
      expect(badge).toHaveClass('px-[5px]', 'py-[2px]')
    })
  })

  describe('uppercase prop', () => {
    it.each([
      { uppercase: undefined, label: 'default (undefined)', expected: 'system-2xs-medium' },
      { uppercase: false, label: 'explicitly false', expected: 'system-2xs-medium' },
      { uppercase: true, label: 'true', expected: 'system-2xs-medium-uppercase' },
    ])('should apply $expected class when uppercase is $label', ({ uppercase, expected }) => {
      render(<Badge uppercase={uppercase}>Text</Badge>)

      expect(screen.getByText('Text')).toHaveClass(expected)
    })
  })

  describe('styleCss prop', () => {
    it('should apply custom inline styles correctly', () => {
      const customStyles = {
        backgroundColor: 'rgb(0, 0, 255)',
        color: 'rgb(255, 255, 255)',
        padding: '10px',
      }
      render(<Badge styleCss={customStyles}>Styled Badge</Badge>)

      expect(screen.getByText('Styled Badge')).toHaveStyle(customStyles)
    })

    it('should apply inline styles without overriding core classes', () => {
      render(<Badge styleCss={{ backgroundColor: 'rgb(255, 0, 0)', margin: '5px' }}>Custom</Badge>)

      const badge = screen.getByText('Custom')
      expect(badge).toHaveStyle({ backgroundColor: 'rgb(255, 0, 0)', margin: '5px' })
      expect(badge).toHaveClass('badge')
    })
  })

  describe('className prop', () => {
    it.each([
      {
        props: { className: 'custom-badge' },
        expected: ['badge', 'custom-badge'],
        label: 'single custom class',
      },
      {
        props: { className: 'custom-class another-class', size: 'l' as const },
        expected: ['badge', 'badge-l', 'custom-class', 'another-class'],
        label: 'multiple classes with size variant',
      },
    ])('should merge $label with default classes', ({ props, expected }) => {
      render(<Badge {...props}>Test</Badge>)

      expect(screen.getByText('Test')).toHaveClass(...expected)
    })
  })

  describe('HTML attributes passthrough', () => {
    it.each([
      { attr: 'data-testid', value: 'custom-badge-id', label: 'data attribute' },
      { attr: 'id', value: 'unique-badge', label: 'id attribute' },
      { attr: 'aria-label', value: 'Notification badge', label: 'aria-label' },
      { attr: 'title', value: 'Hover tooltip', label: 'title attribute' },
      { attr: 'role', value: 'status', label: 'ARIA role' },
    ])('should pass through $label correctly', ({ attr, value }) => {
      render(<Badge {...{ [attr]: value }}>Test</Badge>)

      expect(screen.getByText('Test')).toHaveAttribute(attr, value)
    })

    it('should support multiple HTML attributes simultaneously', () => {
      render(
        <Badge
          data-testid="multi-attr-badge"
          id="badge-123"
          aria-label="Status indicator"
          title="Current status"
        >
          Test
        </Badge>,
      )

      const badge = screen.getByTestId('multi-attr-badge')
      expect(badge).toHaveAttribute('id', 'badge-123')
      expect(badge).toHaveAttribute('aria-label', 'Status indicator')
      expect(badge).toHaveAttribute('title', 'Current status')
    })
  })

  describe('Event handlers', () => {
    it.each([
      { handler: 'onClick', trigger: fireEvent.click, label: 'click' },
      { handler: 'onMouseEnter', trigger: fireEvent.mouseEnter, label: 'mouse enter' },
      { handler: 'onMouseLeave', trigger: fireEvent.mouseLeave, label: 'mouse leave' },
    ])('should trigger $handler when $label occurs', ({ handler, trigger }) => {
      const mockHandler = vi.fn()
      render(<Badge {...{ [handler]: mockHandler }}>Badge</Badge>)

      trigger(screen.getByText('Badge'))

      expect(mockHandler).toHaveBeenCalledTimes(1)
    })

    it('should handle user interaction flow with multiple events', () => {
      const handlers = {
        onClick: vi.fn(),
        onMouseEnter: vi.fn(),
        onMouseLeave: vi.fn(),
      }
      render(<Badge {...handlers}>Interactive</Badge>)

      const badge = screen.getByText('Interactive')
      fireEvent.mouseEnter(badge)
      fireEvent.click(badge)
      fireEvent.mouseLeave(badge)

      expect(handlers.onMouseEnter).toHaveBeenCalledTimes(1)
      expect(handlers.onClick).toHaveBeenCalledTimes(1)
      expect(handlers.onMouseLeave).toHaveBeenCalledTimes(1)
    })

    it('should pass event object to handler with correct properties', () => {
      const handleClick = vi.fn()
      render(<Badge onClick={handleClick}>Event Badge</Badge>)

      fireEvent.click(screen.getByText('Event Badge'))

      expect(handleClick).toHaveBeenCalledWith(expect.objectContaining({
        type: 'click',
      }))
    })
  })

  describe('Combined props', () => {
    it('should correctly apply all props when used together', () => {
      render(
        <Badge
          size="l"
          state={BadgeState.Warning}
          uppercase
          className="custom-badge"
          styleCss={{ backgroundColor: 'rgb(0, 0, 255)' }}
          data-testid="combined-badge"
        >
          Full Featured
        </Badge>,
      )

      const badge = screen.getByTestId('combined-badge')
      expect(badge).toHaveClass('badge', 'badge-l', 'badge-warning', 'system-2xs-medium-uppercase', 'custom-badge')
      expect(badge).toHaveStyle({ backgroundColor: 'rgb(0, 0, 255)' })
      expect(badge).toHaveTextContent('Full Featured')
    })

    it.each([
      {
        props: { size: 'l' as const, state: BadgeState.Accent },
        expected: ['badge', 'badge-l', 'badge-accent'],
        label: 'size and state variants',
      },
      {
        props: { iconOnly: true, uppercase: true },
        expected: ['badge', 'system-2xs-medium-uppercase'],
        label: 'iconOnly and uppercase',
      },
    ])('should combine $label correctly', ({ props, expected }) => {
      render(<Badge {...props}>Test</Badge>)

      expect(screen.getByText('Test')).toHaveClass(...expected)
    })

    it('should handle event handlers with combined props', () => {
      const handleClick = vi.fn()
      render(
        <Badge size="s" state={BadgeState.Warning} onClick={handleClick} className="interactive">
          Test
        </Badge>,
      )

      const badge = screen.getByText('Test')
      expect(badge).toHaveClass('badge', 'badge-s', 'badge-warning', 'interactive')

      fireEvent.click(badge)
      expect(handleClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge cases', () => {
    it.each([
      { children: 42, text: '42', label: 'numeric value' },
      { children: 0, text: '0', label: 'zero' },
    ])('should render $label correctly', ({ children, text }) => {
      render(<Badge>{children}</Badge>)

      expect(screen.getByText(text)).toBeInTheDocument()
    })

    it.each([
      { children: null, label: 'null' },
      { children: false, label: 'boolean false' },
    ])('should handle $label children without errors', ({ children }) => {
      const { container } = render(<Badge>{children}</Badge>)

      expect(container.firstChild).toHaveClass('badge')
    })

    it('should render complex nested content correctly', () => {
      render(
        <Badge>
          <span data-testid="icon">🔔</span>
          <span data-testid="count">5</span>
        </Badge>,
      )

      expect(screen.getByTestId('icon')).toBeInTheDocument()
      expect(screen.getByTestId('count')).toBeInTheDocument()
    })
  })

  describe('Component metadata and exports', () => {
    it('should have correct displayName for debugging', () => {
      expect(Badge.displayName).toBe('Badge')
    })

    describe('BadgeState enum', () => {
      it.each([
        { key: 'Warning', value: 'warning' },
        { key: 'Accent', value: 'accent' },
        { key: 'Default', value: '' },
      ])('should export $key state with value "$value"', ({ key, value }) => {
        expect(BadgeState[key as keyof typeof BadgeState]).toBe(value)
      })
    })

    describe('BadgeVariants utility', () => {
      it('should be a function', () => {
        expect(typeof BadgeVariants).toBe('function')
      })

      it('should generate base badge class with default medium size', () => {
        const result = BadgeVariants({})

        expect(result).toContain('badge')
        expect(result).toContain('badge-m')
      })

      it.each([
        { size: 's' },
        { size: 'm' },
        { size: 'l' },
      ] as const)('should generate correct classes for size=$size', ({ size }) => {
        const result = BadgeVariants({ size })

        expect(result).toContain('badge')
        expect(result).toContain(`badge-${size}`)
      })
    })
  })
})
