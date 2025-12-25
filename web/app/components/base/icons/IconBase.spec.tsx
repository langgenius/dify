import type { IconData } from './IconBase'
import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import IconBase from './IconBase'
import * as utils from './utils'

// Mock the utils module
vi.mock('./utils', () => ({
  generate: vi.fn((icon, key, props) => (
    <svg
      data-testid="mock-svg"
      key={key}
      {...props}
    >
      mocked svg content
    </svg>
  )),
}))

describe('IconBase Component', () => {
  const mockData: IconData = {
    name: 'test-icon',
    icon: { name: 'svg', attributes: {}, children: [] },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders properly with required props', () => {
    render(<IconBase data={mockData} />)
    const svg = screen.getByTestId('mock-svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveAttribute('data-icon', mockData.name)
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('passes className to the generated SVG', () => {
    render(<IconBase data={mockData} className="custom-class" />)
    const svg = screen.getByTestId('mock-svg')
    expect(svg).toHaveAttribute('class', 'custom-class')
    expect(utils.generate).toHaveBeenCalledWith(
      mockData.icon,
      'svg-test-icon',
      expect.objectContaining({ className: 'custom-class' }),
    )
  })

  it('handles onClick events', () => {
    const handleClick = vi.fn()
    render(<IconBase data={mockData} onClick={handleClick} />)
    const svg = screen.getByTestId('mock-svg')
    fireEvent.click(svg)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('applies custom styles', () => {
    const customStyle = { color: 'red', fontSize: '24px' }
    render(<IconBase data={mockData} style={customStyle} />)
    expect(utils.generate).toHaveBeenCalledWith(
      mockData.icon,
      'svg-test-icon',
      expect.objectContaining({ style: customStyle }),
    )
  })
})
