import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import ContentWrapper from './content-wrapper'

describe('ContentWrapper', () => {
  const defaultProps = {
    nodeTitle: 'Human Input Node',
    children: <div data-testid="child-content">Child Content</div>,
  }

  it('should render node title and children by default when not collapsible', () => {
    render(<ContentWrapper {...defaultProps} />)

    expect(screen.getByText('Human Input Node')).toBeInTheDocument()
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(screen.queryByTestId('expand-icon')).not.toBeInTheDocument()
  })

  it('should show/hide content when toggling expansion', async () => {
    const user = userEvent.setup()
    render(<ContentWrapper {...defaultProps} showExpandIcon={true} expanded={false} />)

    // Initially collapsed
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
    const expandToggle = screen.getByTestId('expand-icon')
    expect(expandToggle.querySelector('.i-ri-arrow-right-s-line')).toBeInTheDocument()

    // Expand
    await user.click(expandToggle)
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(expandToggle.querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()

    // Collapse
    await user.click(expandToggle)
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
  })

  it('should render children initially if expanded is true', () => {
    render(<ContentWrapper {...defaultProps} showExpandIcon={true} expanded={true} />)

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    const expandToggle = screen.getByTestId('expand-icon')
    expect(expandToggle.querySelector('.i-ri-arrow-down-s-line')).toBeInTheDocument()
  })
})
