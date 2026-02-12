import { render, screen } from '@testing-library/react'
import NodeStatus, { NodeStatusEnum } from '.'

describe('NodeStatus', () => {
  it('renders with default status (warning) and default message', () => {
    const { container } = render(<NodeStatus />)

    expect(screen.getByText('Warning')).toBeInTheDocument()
    // Default warning class
    expect(container.firstChild).toHaveClass('bg-state-warning-hover')
    expect(container.firstChild).toHaveClass('text-text-warning')
  })

  it('renders with error status and default message', () => {
    const { container } = render(<NodeStatus status={NodeStatusEnum.error} />)

    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(container.firstChild).toHaveClass('bg-state-destructive-hover')
    expect(container.firstChild).toHaveClass('text-text-destructive')
  })

  it('renders with custom message', () => {
    render(<NodeStatus message="Custom Message" />)
    expect(screen.getByText('Custom Message')).toBeInTheDocument()
  })

  it('renders children correctly', () => {
    render(
      <NodeStatus>
        <span data-testid="child">Child Element</span>
      </NodeStatus>,
    )
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.getByText('Child Element')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<NodeStatus className="custom-test-class" />)
    expect(container.firstChild).toHaveClass('custom-test-class')
  })

  it('applies styleCss correctly', () => {
    const { container } = render(<NodeStatus styleCss={{ color: 'red' }} />)
    expect(container.firstChild).toHaveStyle({ color: 'rgb(255, 0, 0)' })
  })

  it('applies iconClassName to the icon', () => {
    const { container } = render(<NodeStatus iconClassName="custom-icon-class" />)
    // The icon is the first child of the div
    const icon = container.querySelector('.custom-icon-class')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('h-3.5')
    expect(icon).toHaveClass('w-3.5')
  })

  it('passes additional HTML attributes to the container', () => {
    render(<NodeStatus data-testid="node-status-container" id="my-id" />)
    const container = screen.getByTestId('node-status-container')
    expect(container).toHaveAttribute('id', 'my-id')
  })
})
