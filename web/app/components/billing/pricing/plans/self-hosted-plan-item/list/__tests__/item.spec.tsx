import { render, screen } from '@testing-library/react'
import * as React from 'react'
import Item from '../item'

describe('SelfHostedPlanItem/List/Item', () => {
  it('should display provided feature label', () => {
    const { container } = render(<Item label="Dedicated support" />)

    expect(screen.getByText('Dedicated support')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('should render the check icon', () => {
    const { container } = render(<Item label="Custom branding" />)

    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('size-4')
  })

  it('should render different labels correctly', () => {
    const { rerender } = render(<Item label="Feature A" />)
    expect(screen.getByText('Feature A')).toBeInTheDocument()

    rerender(<Item label="Feature B" />)
    expect(screen.getByText('Feature B')).toBeInTheDocument()
    expect(screen.queryByText('Feature A')).not.toBeInTheDocument()
  })

  it('should render with empty label', () => {
    const { container } = render(<Item label="" />)

    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
