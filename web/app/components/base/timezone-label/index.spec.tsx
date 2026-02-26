import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TimezoneLabel from './index'

describe('TimezoneLabel', () => {
  it('should render correctly with various timezones', () => {
    const { rerender } = render(<TimezoneLabel timezone="UTC" />)
    const label = screen.getByTestId('timezone-label')
    expect(label).toHaveTextContent('UTC+0')
    expect(label).toHaveAttribute('title', 'Timezone: UTC (UTC+0)')

    rerender(<TimezoneLabel timezone="Asia/Shanghai" />)
    expect(label).toHaveTextContent('UTC+8')
    expect(label).toHaveAttribute('title', 'Timezone: Asia/Shanghai (UTC+8)')

    rerender(<TimezoneLabel timezone="America/New_York" />)
    // New York is UTC-5 or UTC-4 depending on DST.
    // dayjs handles this, we just check it renders some offset.
    expect(label.textContent).toMatch(/UTC[-+]\d+/)
  })

  it('should apply correct styling for inline prop', () => {
    render(<TimezoneLabel timezone="UTC" inline />)
    expect(screen.getByTestId('timezone-label')).toHaveClass('text-text-quaternary')
  })

  it('should apply custom className', () => {
    render(<TimezoneLabel timezone="UTC" className="custom-test-class" />)
    expect(screen.getByTestId('timezone-label')).toHaveClass('custom-test-class')
  })
})
