import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Theme } from '@/types/app'
import Partner from './partner'

// Mock useTheme hook
const mockUseTheme = vi.fn()
vi.mock('@/hooks/use-theme', () => ({
  default: () => mockUseTheme(),
}))

// Mock IconWithTooltip to directly test Partner's behavior
type IconWithTooltipProps = ComponentProps<typeof import('./icon-with-tooltip').default>
const mockIconWithTooltip = vi.fn()
vi.mock('./icon-with-tooltip', () => ({
  default: (props: IconWithTooltipProps) => {
    mockIconWithTooltip(props)
    const { theme, BadgeIconLight, BadgeIconDark, className, popupContent } = props
    const isDark = theme === Theme.dark
    const Icon = isDark ? BadgeIconDark : BadgeIconLight
    return (
      <div data-testid="icon-with-tooltip" data-popup-content={popupContent} data-theme={theme}>
        <Icon className={className} data-testid={isDark ? 'partner-dark-icon' : 'partner-light-icon'} />
      </div>
    )
  },
}))

// Mock Partner icons
vi.mock('@/app/components/base/icons/src/public/plugins/PartnerDark', () => ({
  default: ({ className, ...rest }: { className?: string }) => (
    <div data-testid="partner-dark-icon" className={className} {...rest}>PartnerDark</div>
  ),
}))

vi.mock('@/app/components/base/icons/src/public/plugins/PartnerLight', () => ({
  default: ({ className, ...rest }: { className?: string }) => (
    <div data-testid="partner-light-icon" className={className} {...rest}>PartnerLight</div>
  ),
}))

describe('Partner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTheme.mockReturnValue({ theme: Theme.light })
    mockIconWithTooltip.mockClear()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<Partner text="Partner Tip" />)

      expect(screen.getByTestId('icon-with-tooltip')).toBeInTheDocument()
    })

    it('should call useTheme hook', () => {
      render(<Partner text="Partner" />)

      expect(mockUseTheme).toHaveBeenCalled()
    })

    it('should pass text prop as popupContent to IconWithTooltip', () => {
      render(<Partner text="This is a partner" />)

      expect(screen.getByTestId('icon-with-tooltip')).toHaveAttribute(
        'data-popup-content',
        'This is a partner',
      )
      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ popupContent: 'This is a partner' }),
      )
    })

    it('should pass theme from useTheme to IconWithTooltip', () => {
      mockUseTheme.mockReturnValue({ theme: Theme.light })
      render(<Partner text="Partner" />)

      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ theme: Theme.light }),
      )
    })

    it('should render light icon in light theme', () => {
      mockUseTheme.mockReturnValue({ theme: Theme.light })
      render(<Partner text="Partner" />)

      expect(screen.getByTestId('partner-light-icon')).toBeInTheDocument()
    })

    it('should render dark icon in dark theme', () => {
      mockUseTheme.mockReturnValue({ theme: Theme.dark })
      render(<Partner text="Partner" />)

      expect(screen.getByTestId('partner-dark-icon')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should pass className to IconWithTooltip', () => {
      render(<Partner className="custom-class" text="Partner" />)

      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ className: 'custom-class' }),
      )
    })

    it('should pass correct BadgeIcon components to IconWithTooltip', () => {
      render(<Partner text="Partner" />)

      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({
          BadgeIconLight: expect.any(Function),
          BadgeIconDark: expect.any(Function),
        }),
      )
    })
  })

  describe('Theme Handling', () => {
    it('should handle light theme correctly', () => {
      mockUseTheme.mockReturnValue({ theme: Theme.light })
      render(<Partner text="Partner" />)

      expect(mockUseTheme).toHaveBeenCalled()
      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ theme: Theme.light }),
      )
      expect(screen.getByTestId('partner-light-icon')).toBeInTheDocument()
    })

    it('should handle dark theme correctly', () => {
      mockUseTheme.mockReturnValue({ theme: Theme.dark })
      render(<Partner text="Partner" />)

      expect(mockUseTheme).toHaveBeenCalled()
      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ theme: Theme.dark }),
      )
      expect(screen.getByTestId('partner-dark-icon')).toBeInTheDocument()
    })

    it('should pass updated theme when theme changes', () => {
      mockUseTheme.mockReturnValue({ theme: Theme.light })
      const { rerender } = render(<Partner text="Partner" />)

      expect(mockIconWithTooltip).toHaveBeenLastCalledWith(
        expect.objectContaining({ theme: Theme.light }),
      )

      mockIconWithTooltip.mockClear()
      mockUseTheme.mockReturnValue({ theme: Theme.dark })
      rerender(<Partner text="Partner" />)

      expect(mockIconWithTooltip).toHaveBeenLastCalledWith(
        expect.objectContaining({ theme: Theme.dark }),
      )
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      render(<Partner text="" />)

      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ popupContent: '' }),
      )
    })

    it('should handle long text', () => {
      const longText = 'A'.repeat(500)
      render(<Partner text={longText} />)

      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ popupContent: longText }),
      )
    })

    it('should handle special characters in text', () => {
      const specialText = '<script>alert("xss")</script>'
      render(<Partner text={specialText} />)

      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ popupContent: specialText }),
      )
    })

    it('should handle undefined className', () => {
      render(<Partner text="Partner" />)

      expect(mockIconWithTooltip).toHaveBeenCalledWith(
        expect.objectContaining({ className: undefined }),
      )
    })

    it('should always call useTheme to get current theme', () => {
      render(<Partner text="Partner 1" />)
      expect(mockUseTheme).toHaveBeenCalledTimes(1)

      mockUseTheme.mockClear()
      render(<Partner text="Partner 2" />)
      expect(mockUseTheme).toHaveBeenCalledTimes(1)
    })
  })
})
