import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Empty from './index'
import Line from './line'

// ================================
// Mock external dependencies only
// ================================

// Mock i18n translation hook
vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => {
      // Build full key with namespace prefix if provided
      const fullKey = options?.ns ? `${options.ns}.${key}` : key
      const translations: Record<string, string> = {
        'plugin.marketplace.noPluginFound': 'No plugin found',
      }
      return translations[fullKey] || key
    },
  }),
}))

// Mock useTheme hook with controllable theme value
let mockTheme = 'light'

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: mockTheme,
  }),
}))

// ================================
// Line Component Tests
// ================================
describe('Line', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'light'
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Line />)

      expect(container.querySelector('svg')).toBeInTheDocument()
    })

    it('should render SVG element', () => {
      const { container } = render(<Line />)

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
      expect(svg).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg')
    })
  })

  // ================================
  // Light Theme Tests
  // ================================
  describe('Light Theme', () => {
    beforeEach(() => {
      mockTheme = 'light'
    })

    it('should render light mode SVG', () => {
      const { container } = render(<Line />)

      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '2')
      expect(svg).toHaveAttribute('height', '241')
      expect(svg).toHaveAttribute('viewBox', '0 0 2 241')
    })

    it('should render light mode path with correct d attribute', () => {
      const { container } = render(<Line />)

      const path = container.querySelector('path')
      expect(path).toHaveAttribute('d', 'M1 0.5L1 240.5')
    })

    it('should render light mode linear gradient with correct id', () => {
      const { container } = render(<Line />)

      const gradient = container.querySelector('#paint0_linear_1989_74474')
      expect(gradient).toBeInTheDocument()
    })

    it('should render light mode gradient with white stop colors', () => {
      const { container } = render(<Line />)

      const stops = container.querySelectorAll('stop')
      expect(stops.length).toBe(3)

      // First stop - white with 0.01 opacity
      expect(stops[0]).toHaveAttribute('stop-color', 'white')
      expect(stops[0]).toHaveAttribute('stop-opacity', '0.01')

      // Middle stop - dark color with 0.08 opacity
      expect(stops[1]).toHaveAttribute('stop-color', '#101828')
      expect(stops[1]).toHaveAttribute('stop-opacity', '0.08')

      // Last stop - white with 0.01 opacity
      expect(stops[2]).toHaveAttribute('stop-color', 'white')
      expect(stops[2]).toHaveAttribute('stop-opacity', '0.01')
    })

    it('should apply className to SVG in light mode', () => {
      const { container } = render(<Line className="test-class" />)

      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('test-class')
    })
  })

  // ================================
  // Dark Theme Tests
  // ================================
  describe('Dark Theme', () => {
    beforeEach(() => {
      mockTheme = 'dark'
    })

    it('should render dark mode SVG', () => {
      const { container } = render(<Line />)

      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('width', '2')
      expect(svg).toHaveAttribute('height', '240')
      expect(svg).toHaveAttribute('viewBox', '0 0 2 240')
    })

    it('should render dark mode path with correct d attribute', () => {
      const { container } = render(<Line />)

      const path = container.querySelector('path')
      expect(path).toHaveAttribute('d', 'M1 0L1 240')
    })

    it('should render dark mode linear gradient with correct id', () => {
      const { container } = render(<Line />)

      const gradient = container.querySelector('#paint0_linear_6295_52176')
      expect(gradient).toBeInTheDocument()
    })

    it('should render dark mode gradient stops', () => {
      const { container } = render(<Line />)

      const stops = container.querySelectorAll('stop')
      expect(stops.length).toBe(3)

      // First stop - no color, 0.01 opacity
      expect(stops[0]).toHaveAttribute('stop-opacity', '0.01')

      // Middle stop - light color with 0.14 opacity
      expect(stops[1]).toHaveAttribute('stop-color', '#C8CEDA')
      expect(stops[1]).toHaveAttribute('stop-opacity', '0.14')

      // Last stop - no color, 0.01 opacity
      expect(stops[2]).toHaveAttribute('stop-opacity', '0.01')
    })

    it('should apply className to SVG in dark mode', () => {
      const { container } = render(<Line className="dark-test-class" />)

      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('dark-test-class')
    })
  })

  // ================================
  // Props Variations Tests
  // ================================
  describe('Props Variations', () => {
    it('should handle undefined className', () => {
      const { container } = render(<Line />)

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should handle empty string className', () => {
      const { container } = render(<Line className="" />)

      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should handle multiple class names', () => {
      const { container } = render(<Line className="class-1 class-2 class-3" />)

      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('class-1')
      expect(svg).toHaveClass('class-2')
      expect(svg).toHaveClass('class-3')
    })

    it('should handle Tailwind utility classes', () => {
      const { container } = render(
        <Line className="absolute right-[-1px] top-1/2 -translate-y-1/2" />,
      )

      const svg = container.querySelector('svg')
      expect(svg).toHaveClass('absolute')
      expect(svg).toHaveClass('right-[-1px]')
      expect(svg).toHaveClass('top-1/2')
      expect(svg).toHaveClass('-translate-y-1/2')
    })
  })

  // ================================
  // Theme Switching Tests
  // ================================
  describe('Theme Switching', () => {
    it('should render different SVG dimensions based on theme', () => {
      // Light mode
      mockTheme = 'light'
      const { container: lightContainer, unmount: unmountLight } = render(<Line />)
      expect(lightContainer.querySelector('svg')).toHaveAttribute('height', '241')
      unmountLight()

      // Dark mode
      mockTheme = 'dark'
      const { container: darkContainer } = render(<Line />)
      expect(darkContainer.querySelector('svg')).toHaveAttribute('height', '240')
    })

    it('should use different gradient IDs based on theme', () => {
      // Light mode
      mockTheme = 'light'
      const { container: lightContainer, unmount: unmountLight } = render(<Line />)
      expect(lightContainer.querySelector('#paint0_linear_1989_74474')).toBeInTheDocument()
      expect(lightContainer.querySelector('#paint0_linear_6295_52176')).not.toBeInTheDocument()
      unmountLight()

      // Dark mode
      mockTheme = 'dark'
      const { container: darkContainer } = render(<Line />)
      expect(darkContainer.querySelector('#paint0_linear_6295_52176')).toBeInTheDocument()
      expect(darkContainer.querySelector('#paint0_linear_1989_74474')).not.toBeInTheDocument()
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle theme value of light explicitly', () => {
      mockTheme = 'light'
      const { container } = render(<Line />)

      expect(container.querySelector('#paint0_linear_1989_74474')).toBeInTheDocument()
    })

    it('should handle non-dark theme as light mode', () => {
      mockTheme = 'system'
      const { container } = render(<Line />)

      // Non-dark themes should use light mode SVG
      expect(container.querySelector('svg')).toHaveAttribute('height', '241')
    })

    it('should render SVG with fill none', () => {
      const { container } = render(<Line />)

      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('fill', 'none')
    })

    it('should render path with gradient stroke', () => {
      mockTheme = 'light'
      const { container } = render(<Line />)

      const path = container.querySelector('path')
      expect(path).toHaveAttribute('stroke', 'url(#paint0_linear_1989_74474)')
    })

    it('should render dark mode path with gradient stroke', () => {
      mockTheme = 'dark'
      const { container } = render(<Line />)

      const path = container.querySelector('path')
      expect(path).toHaveAttribute('stroke', 'url(#paint0_linear_6295_52176)')
    })
  })
})

// ================================
// Empty Component Tests
// ================================
describe('Empty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'light'
  })

  // ================================
  // Rendering Tests
  // ================================
  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Empty />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should render 16 placeholder cards', () => {
      const { container } = render(<Empty />)

      const placeholderCards = container.querySelectorAll('.h-\\[144px\\]')
      expect(placeholderCards.length).toBe(16)
    })

    it('should render default no plugin found text', () => {
      render(<Empty />)

      expect(screen.getByText('No plugin found')).toBeInTheDocument()
    })

    it('should render Group icon', () => {
      const { container } = render(<Empty />)

      // Icon wrapper should be present
      const iconWrapper = container.querySelector('.h-14.w-14')
      expect(iconWrapper).toBeInTheDocument()
    })

    it('should render four Line components around the icon', () => {
      const { container } = render(<Empty />)

      // Four SVG elements from Line components + 1 Group icon SVG = 5 total
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBe(5)
    })

    it('should render center content with absolute positioning', () => {
      const { container } = render(<Empty />)

      const centerContent = container.querySelector('.absolute.left-1\\/2.top-1\\/2')
      expect(centerContent).toBeInTheDocument()
    })
  })

  // ================================
  // Text Prop Tests
  // ================================
  describe('Text Prop', () => {
    it('should render custom text when provided', () => {
      render(<Empty text="Custom empty message" />)

      expect(screen.getByText('Custom empty message')).toBeInTheDocument()
      expect(screen.queryByText('No plugin found')).not.toBeInTheDocument()
    })

    it('should render default translation when text is empty string', () => {
      render(<Empty text="" />)

      expect(screen.getByText('No plugin found')).toBeInTheDocument()
    })

    it('should render default translation when text is undefined', () => {
      render(<Empty text={undefined} />)

      expect(screen.getByText('No plugin found')).toBeInTheDocument()
    })

    it('should render long custom text', () => {
      const longText = 'This is a very long message that describes why there are no plugins found in the current search results and what the user might want to do next to find what they are looking for'
      render(<Empty text={longText} />)

      expect(screen.getByText(longText)).toBeInTheDocument()
    })

    it('should render text with special characters', () => {
      render(<Empty text="No plugins found for query: <search>" />)

      expect(screen.getByText('No plugins found for query: <search>')).toBeInTheDocument()
    })
  })

  // ================================
  // LightCard Prop Tests
  // ================================
  describe('LightCard Prop', () => {
    it('should render overlay when lightCard is false', () => {
      const { container } = render(<Empty lightCard={false} />)

      const overlay = container.querySelector('.bg-marketplace-plugin-empty')
      expect(overlay).toBeInTheDocument()
    })

    it('should not render overlay when lightCard is true', () => {
      const { container } = render(<Empty lightCard />)

      const overlay = container.querySelector('.bg-marketplace-plugin-empty')
      expect(overlay).not.toBeInTheDocument()
    })

    it('should render overlay by default when lightCard is undefined', () => {
      const { container } = render(<Empty />)

      const overlay = container.querySelector('.bg-marketplace-plugin-empty')
      expect(overlay).toBeInTheDocument()
    })

    it('should apply light card styling to placeholder cards when lightCard is true', () => {
      const { container } = render(<Empty lightCard />)

      const placeholderCards = container.querySelectorAll('.bg-background-default-lighter')
      expect(placeholderCards.length).toBe(16)
    })

    it('should apply default styling to placeholder cards when lightCard is false', () => {
      const { container } = render(<Empty lightCard={false} />)

      const placeholderCards = container.querySelectorAll('.bg-background-section-burn')
      expect(placeholderCards.length).toBe(16)
    })

    it('should apply opacity to light card placeholder', () => {
      const { container } = render(<Empty lightCard />)

      const placeholderCards = container.querySelectorAll('.opacity-75')
      expect(placeholderCards.length).toBe(16)
    })
  })

  // ================================
  // ClassName Prop Tests
  // ================================
  describe('ClassName Prop', () => {
    it('should apply custom className to container', () => {
      const { container } = render(<Empty className="custom-class" />)

      expect(container.querySelector('.custom-class')).toBeInTheDocument()
    })

    it('should preserve base classes when adding custom className', () => {
      const { container } = render(<Empty className="custom-class" />)

      const element = container.querySelector('.custom-class')
      expect(element).toHaveClass('relative')
      expect(element).toHaveClass('flex')
      expect(element).toHaveClass('h-0')
      expect(element).toHaveClass('grow')
    })

    it('should handle empty string className', () => {
      const { container } = render(<Empty className="" />)

      expect(container.firstChild).toBeInTheDocument()
    })

    it('should handle undefined className', () => {
      const { container } = render(<Empty />)

      const element = container.firstChild as HTMLElement
      expect(element).toHaveClass('relative')
    })

    it('should handle multiple custom classes', () => {
      const { container } = render(<Empty className="class-a class-b class-c" />)

      const element = container.querySelector('.class-a')
      expect(element).toHaveClass('class-b')
      expect(element).toHaveClass('class-c')
    })
  })

  // ================================
  // Placeholder Cards Layout Tests
  // ================================
  describe('Placeholder Cards Layout', () => {
    it('should remove right margin on every 4th card', () => {
      const { container } = render(<Empty />)

      const cards = container.querySelectorAll('.h-\\[144px\\]')

      // Cards at indices 3, 7, 11, 15 (4th, 8th, 12th, 16th) should have mr-0
      expect(cards[3]).toHaveClass('mr-0')
      expect(cards[7]).toHaveClass('mr-0')
      expect(cards[11]).toHaveClass('mr-0')
      expect(cards[15]).toHaveClass('mr-0')
    })

    it('should have margin on cards that are not at the end of row', () => {
      const { container } = render(<Empty />)

      const cards = container.querySelectorAll('.h-\\[144px\\]')

      // Cards not at row end should have mr-3
      expect(cards[0]).toHaveClass('mr-3')
      expect(cards[1]).toHaveClass('mr-3')
      expect(cards[2]).toHaveClass('mr-3')
    })

    it('should remove bottom margin on last row cards', () => {
      const { container } = render(<Empty />)

      const cards = container.querySelectorAll('.h-\\[144px\\]')

      // Cards at indices 12, 13, 14, 15 should have mb-0
      expect(cards[12]).toHaveClass('mb-0')
      expect(cards[13]).toHaveClass('mb-0')
      expect(cards[14]).toHaveClass('mb-0')
      expect(cards[15]).toHaveClass('mb-0')
    })

    it('should have bottom margin on non-last row cards', () => {
      const { container } = render(<Empty />)

      const cards = container.querySelectorAll('.h-\\[144px\\]')

      // Cards at indices 0-11 should have mb-3
      expect(cards[0]).toHaveClass('mb-3')
      expect(cards[5]).toHaveClass('mb-3')
      expect(cards[11]).toHaveClass('mb-3')
    })

    it('should have correct width calculation for 4 columns', () => {
      const { container } = render(<Empty />)

      const cards = container.querySelectorAll('.w-\\[calc\\(\\(100\\%-36px\\)\\/4\\)\\]')
      expect(cards.length).toBe(16)
    })

    it('should have rounded corners on cards', () => {
      const { container } = render(<Empty />)

      const cards = container.querySelectorAll('.rounded-xl')
      // 16 cards + 1 icon wrapper = 17 rounded-xl elements
      expect(cards.length).toBeGreaterThanOrEqual(16)
    })
  })

  // ================================
  // Icon Container Tests
  // ================================
  describe('Icon Container', () => {
    it('should render icon container with border', () => {
      const { container } = render(<Empty />)

      const iconContainer = container.querySelector('.border-dashed')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render icon container with shadow', () => {
      const { container } = render(<Empty />)

      const iconContainer = container.querySelector('.shadow-lg')
      expect(iconContainer).toBeInTheDocument()
    })

    it('should render icon container centered', () => {
      const { container } = render(<Empty />)

      const centerWrapper = container.querySelector('.-translate-x-1\\/2.-translate-y-1\\/2')
      expect(centerWrapper).toBeInTheDocument()
    })

    it('should have z-index for center content', () => {
      const { container } = render(<Empty />)

      const centerContent = container.querySelector('.z-\\[2\\]')
      expect(centerContent).toBeInTheDocument()
    })
  })

  // ================================
  // Line Positioning Tests
  // ================================
  describe('Line Positioning', () => {
    it('should position Line components correctly around icon', () => {
      const { container } = render(<Empty />)

      // Right line
      const rightLine = container.querySelector('.right-\\[-1px\\]')
      expect(rightLine).toBeInTheDocument()

      // Left line
      const leftLine = container.querySelector('.left-\\[-1px\\]')
      expect(leftLine).toBeInTheDocument()
    })

    it('should have rotated Line components for top and bottom', () => {
      const { container } = render(<Empty />)

      const rotatedLines = container.querySelectorAll('.rotate-90')
      expect(rotatedLines.length).toBe(2)
    })
  })

  // ================================
  // Combined Props Tests
  // ================================
  describe('Combined Props', () => {
    it('should handle all props together', () => {
      const { container } = render(
        <Empty
          text="Custom message"
          lightCard
          className="custom-wrapper"
        />,
      )

      expect(screen.getByText('Custom message')).toBeInTheDocument()
      expect(container.querySelector('.custom-wrapper')).toBeInTheDocument()
      expect(container.querySelector('.bg-marketplace-plugin-empty')).not.toBeInTheDocument()
    })

    it('should render correctly with lightCard false and custom text', () => {
      const { container } = render(
        <Empty text="No results" lightCard={false} />,
      )

      expect(screen.getByText('No results')).toBeInTheDocument()
      expect(container.querySelector('.bg-marketplace-plugin-empty')).toBeInTheDocument()
    })

    it('should handle className with lightCard prop', () => {
      const { container } = render(
        <Empty className="test-class" lightCard />,
      )

      const element = container.querySelector('.test-class')
      expect(element).toBeInTheDocument()

      // Verify light card styling is applied
      const lightCards = container.querySelectorAll('.bg-background-default-lighter')
      expect(lightCards.length).toBe(16)
    })
  })

  // ================================
  // Edge Cases Tests
  // ================================
  describe('Edge Cases', () => {
    it('should handle empty props object', () => {
      const { container } = render(<Empty />)

      expect(container.firstChild).toBeInTheDocument()
      expect(screen.getByText('No plugin found')).toBeInTheDocument()
    })

    it('should render with only text prop', () => {
      render(<Empty text="Only text" />)

      expect(screen.getByText('Only text')).toBeInTheDocument()
    })

    it('should render with only lightCard prop', () => {
      const { container } = render(<Empty lightCard />)

      expect(container.querySelector('.bg-marketplace-plugin-empty')).not.toBeInTheDocument()
    })

    it('should render with only className prop', () => {
      const { container } = render(<Empty className="only-class" />)

      expect(container.querySelector('.only-class')).toBeInTheDocument()
    })

    it('should handle text with unicode characters', () => {
      render(<Empty text="没有找到插件 🔍" />)

      expect(screen.getByText('没有找到插件 🔍')).toBeInTheDocument()
    })

    it('should handle text with HTML entities', () => {
      render(<Empty text="No plugins &amp; no results" />)

      expect(screen.getByText('No plugins & no results')).toBeInTheDocument()
    })

    it('should handle whitespace-only text', () => {
      const { container } = render(<Empty text="   " />)

      // Whitespace-only text is truthy, so it should be rendered
      const textContainer = container.querySelector('.system-md-regular')
      expect(textContainer).toBeInTheDocument()
      expect(textContainer?.textContent).toBe('   ')
    })
  })

  // ================================
  // Accessibility Tests
  // ================================
  describe('Accessibility', () => {
    it('should have text content visible', () => {
      render(<Empty text="No plugins available" />)

      const textElement = screen.getByText('No plugins available')
      expect(textElement).toBeVisible()
    })

    it('should render text in proper container', () => {
      const { container } = render(<Empty text="Test message" />)

      const textContainer = container.querySelector('.system-md-regular')
      expect(textContainer).toBeInTheDocument()
      expect(textContainer).toHaveTextContent('Test message')
    })

    it('should center text content', () => {
      const { container } = render(<Empty />)

      const textContainer = container.querySelector('.text-center')
      expect(textContainer).toBeInTheDocument()
    })
  })

  // ================================
  // Overlay Tests
  // ================================
  describe('Overlay', () => {
    it('should render overlay with correct z-index', () => {
      const { container } = render(<Empty />)

      const overlay = container.querySelector('.z-\\[1\\]')
      expect(overlay).toBeInTheDocument()
    })

    it('should render overlay with full coverage', () => {
      const { container } = render(<Empty />)

      const overlay = container.querySelector('.inset-0')
      expect(overlay).toBeInTheDocument()
    })

    it('should not render overlay when lightCard is true', () => {
      const { container } = render(<Empty lightCard />)

      const overlay = container.querySelector('.inset-0.z-\\[1\\]')
      expect(overlay).not.toBeInTheDocument()
    })
  })
})

// ================================
// Integration Tests
// ================================
describe('Empty and Line Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTheme = 'light'
  })

  it('should render Line components with correct theme in Empty', () => {
    const { container } = render(<Empty />)

    // In light mode, should use light gradient ID
    const lightGradients = container.querySelectorAll('#paint0_linear_1989_74474')
    expect(lightGradients.length).toBe(4)
  })

  it('should render Line components with dark theme in Empty', () => {
    mockTheme = 'dark'
    const { container } = render(<Empty />)

    // In dark mode, should use dark gradient ID
    const darkGradients = container.querySelectorAll('#paint0_linear_6295_52176')
    expect(darkGradients.length).toBe(4)
  })

  it('should apply positioning classes to Line components', () => {
    const { container } = render(<Empty />)

    // Check for Line positioning classes
    expect(container.querySelector('.right-\\[-1px\\]')).toBeInTheDocument()
    expect(container.querySelector('.left-\\[-1px\\]')).toBeInTheDocument()
    expect(container.querySelectorAll('.rotate-90').length).toBe(2)
  })

  it('should render complete Empty component structure', () => {
    const { container } = render(<Empty text="Test" lightCard className="test" />)

    // Container
    expect(container.querySelector('.test')).toBeInTheDocument()

    // Placeholder cards
    expect(container.querySelectorAll('.h-\\[144px\\]').length).toBe(16)

    // Icon container
    expect(container.querySelector('.h-14.w-14')).toBeInTheDocument()

    // Line components (4) + Group icon (1) = 5 SVGs total
    expect(container.querySelectorAll('svg').length).toBe(5)

    // Text
    expect(screen.getByText('Test')).toBeInTheDocument()

    // No overlay for lightCard
    expect(container.querySelector('.bg-marketplace-plugin-empty')).not.toBeInTheDocument()
  })
})
