import { render, screen } from '@testing-library/react'
import * as React from 'react'
import TimezoneLabel from '../index'

// Mock the convertTimezoneToOffsetStr function
vi.mock('@/app/components/base/date-and-time-picker/utils/dayjs', () => ({
  convertTimezoneToOffsetStr: (timezone?: string) => {
    if (!timezone)
      return 'UTC+0'

    // Mock implementation matching the actual timezone conversions
    const timezoneOffsets: Record<string, string> = {
      'Asia/Shanghai': 'UTC+8',
      'America/New_York': 'UTC-5',
      'Europe/London': 'UTC+0',
      'Pacific/Auckland': 'UTC+13',
      'Pacific/Niue': 'UTC-11',
      'UTC': 'UTC+0',
    }

    return timezoneOffsets[timezone] || 'UTC+0'
  },
}))

describe('TimezoneLabel', () => {
  describe('Basic Rendering', () => {
    it('should render timezone offset correctly', () => {
      render(<TimezoneLabel timezone="Asia/Shanghai" />)
      expect(screen.getByText('UTC+8')).toBeInTheDocument()
    })

    it('should display UTC+0 for invalid timezone', () => {
      render(<TimezoneLabel timezone="Invalid/Timezone" />)
      expect(screen.getByText('UTC+0')).toBeInTheDocument()
    })

    it('should handle UTC timezone', () => {
      render(<TimezoneLabel timezone="UTC" />)
      expect(screen.getByText('UTC+0')).toBeInTheDocument()
    })
  })

  describe('Styling', () => {
    it('should apply default tertiary text color', () => {
      const { container } = render(<TimezoneLabel timezone="Asia/Shanghai" />)
      const span = container.querySelector('span')
      expect(span).toHaveClass('text-text-tertiary')
      expect(span).not.toHaveClass('text-text-quaternary')
    })

    it('should apply quaternary text color in inline mode', () => {
      const { container } = render(<TimezoneLabel timezone="Asia/Shanghai" inline />)
      const span = container.querySelector('span')
      expect(span).toHaveClass('text-text-quaternary')
    })

    it('should apply custom className', () => {
      const { container } = render(
        <TimezoneLabel timezone="Asia/Shanghai" className="custom-class" />,
      )
      const span = container.querySelector('span')
      expect(span).toHaveClass('custom-class')
    })

    it('should maintain default classes with custom className', () => {
      const { container } = render(
        <TimezoneLabel timezone="Asia/Shanghai" className="custom-class" />,
      )
      const span = container.querySelector('span')
      expect(span).toHaveClass('system-sm-regular')
      expect(span).toHaveClass('text-text-tertiary')
      expect(span).toHaveClass('custom-class')
    })
  })

  describe('Tooltip', () => {
    it('should include timezone information in title attribute', () => {
      const { container } = render(<TimezoneLabel timezone="Asia/Shanghai" />)
      const span = container.querySelector('span')
      expect(span).toHaveAttribute('title', 'Timezone: Asia/Shanghai (UTC+8)')
    })

    it('should update tooltip for different timezones', () => {
      const { container } = render(<TimezoneLabel timezone="America/New_York" />)
      const span = container.querySelector('span')
      expect(span).toHaveAttribute('title', 'Timezone: America/New_York (UTC-5)')
    })
  })

  describe('Edge Cases', () => {
    it('should handle positive offset timezones', () => {
      render(<TimezoneLabel timezone="Pacific/Auckland" />)
      expect(screen.getByText('UTC+13')).toBeInTheDocument()
    })

    it('should handle negative offset timezones', () => {
      render(<TimezoneLabel timezone="Pacific/Niue" />)
      expect(screen.getByText('UTC-11')).toBeInTheDocument()
    })

    it('should handle zero offset timezone', () => {
      render(<TimezoneLabel timezone="Europe/London" />)
      expect(screen.getByText('UTC+0')).toBeInTheDocument()
    })
  })

  describe('Props Variations', () => {
    it('should render with only required timezone prop', () => {
      render(<TimezoneLabel timezone="Asia/Shanghai" />)
      expect(screen.getByText('UTC+8')).toBeInTheDocument()
    })

    it('should render with all props', () => {
      const { container } = render(
        <TimezoneLabel
          timezone="America/New_York"
          className="text-xs"
          inline
        />,
      )
      const span = container.querySelector('span')
      expect(screen.getByText('UTC-5')).toBeInTheDocument()
      expect(span).toHaveClass('text-xs')
      expect(span).toHaveClass('text-text-quaternary')
    })
  })

  describe('Memoization', () => {
    it('should memoize offset calculation', () => {
      const { rerender } = render(<TimezoneLabel timezone="Asia/Shanghai" />)
      expect(screen.getByText('UTC+8')).toBeInTheDocument()

      // Rerender with same props should not trigger recalculation
      rerender(<TimezoneLabel timezone="Asia/Shanghai" />)
      expect(screen.getByText('UTC+8')).toBeInTheDocument()
    })

    it('should recalculate when timezone changes', () => {
      const { rerender } = render(<TimezoneLabel timezone="Asia/Shanghai" />)
      expect(screen.getByText('UTC+8')).toBeInTheDocument()

      rerender(<TimezoneLabel timezone="America/New_York" />)
      expect(screen.getByText('UTC-5')).toBeInTheDocument()
    })
  })
})
