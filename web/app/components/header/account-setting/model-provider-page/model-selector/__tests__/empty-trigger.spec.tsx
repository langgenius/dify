import { render, screen } from '@testing-library/react'
import EmptyTrigger from '../empty-trigger'

describe('EmptyTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render configure model text', () => {
    render(<EmptyTrigger open={false} />)
    expect(screen.getByText('plugin.detailPanel.configureModel')).toBeInTheDocument()
  })

  // open=true: hover bg class present
  it('should apply hover background class when open is true', () => {
    // Act
    const { container } = render(<EmptyTrigger open={true} />)

    // Assert
    expect(container.firstChild).toHaveClass('bg-components-input-bg-hover')
  })

  // className prop truthy: custom className appears on root
  it('should apply custom className when provided', () => {
    // Act
    const { container } = render(<EmptyTrigger open={false} className="custom-class" />)

    // Assert
    expect(container.firstChild).toHaveClass('custom-class')
  })
})
