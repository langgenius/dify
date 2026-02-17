import { render, screen } from '@testing-library/react'
import More from './more'

describe('More', () => {
  const mockMoreData = {
    latency: 0.5,
    tokens: 100,
    tokens_per_second: 200,
    time: '2023-10-27 10:00:00',
  }

  it('should render all details when all data is provided', () => {
    render(<More more={mockMoreData} />)

    expect(screen.getByTestId('more-container')).toBeInTheDocument()

    // Check latency
    expect(screen.getByTestId('more-latency')).toBeInTheDocument()
    expect(screen.getByText(/timeConsuming/i)).toBeInTheDocument()
    expect(screen.getByText(/0.5/)).toBeInTheDocument()
    expect(screen.getByText(/second/i)).toBeInTheDocument()

    // Check tokens
    expect(screen.getByTestId('more-tokens')).toBeInTheDocument()
    expect(screen.getByText(/tokenCost/i)).toBeInTheDocument()
    expect(screen.getByText(/100/)).toBeInTheDocument()

    // Check tokens per second
    expect(screen.getByTestId('more-tps')).toBeInTheDocument()
    expect(screen.getByText(/200 tokens\/s/i)).toBeInTheDocument()

    // Check time
    expect(screen.getByTestId('more-time')).toBeInTheDocument()
    expect(screen.getByText('2023-10-27 10:00:00')).toBeInTheDocument()
  })

  it('should not render tokens per second when it is missing', () => {
    const dataWithoutTPS = { ...mockMoreData, tokens_per_second: 0 }
    render(<More more={dataWithoutTPS} />)

    expect(screen.queryByTestId('more-tps')).not.toBeInTheDocument()
  })

  it('should render nothing inside container if more prop is missing', () => {
    render(<More more={undefined} />)
    const containerDiv = screen.getByTestId('more-container')
    expect(containerDiv).toBeInTheDocument()
    expect(containerDiv.children.length).toBe(0)
  })

  it('should apply group-hover opacity classes', () => {
    render(<More more={mockMoreData} />)
    const container = screen.getByTestId('more-container')
    expect(container).toHaveClass('opacity-0')
    expect(container).toHaveClass('group-hover:opacity-100')
  })

  it('should correctly format large token counts', () => {
    const dataWithLargeTokens = { ...mockMoreData, tokens: 1234567 }
    render(<More more={dataWithLargeTokens} />)

    // formatNumber(1234567) should return '1,234,567'
    expect(screen.getByText(/1,234,567/)).toBeInTheDocument()
  })
})
