import { render, screen } from '@testing-library/react'
import TimezoneLabel from '../index'

describe('TimezoneLabel', () => {
  it('shows the timezone offset and source timezone', () => {
    const { rerender } = render(<TimezoneLabel timezone="UTC" />)

    expect(screen.getByText('UTC+0')).toHaveAttribute('title', 'Timezone: UTC (UTC+0)')

    rerender(<TimezoneLabel timezone="Asia/Shanghai" />)
    expect(screen.getByText('UTC+8')).toHaveAttribute('title', 'Timezone: Asia/Shanghai (UTC+8)')
  })
})
