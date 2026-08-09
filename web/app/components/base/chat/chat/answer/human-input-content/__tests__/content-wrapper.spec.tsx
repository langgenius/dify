import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import ContentWrapper from '../content-wrapper'

describe('ContentWrapper', () => {
  const defaultProps = {
    nodeTitle: 'Human Input Node',
  }
  const childContent = <div data-testid="child-content">Child Content</div>

  it('should render node title and children by default when not collapsible', () => {
    render(<ContentWrapper {...defaultProps}>{childContent}</ContentWrapper>)

    expect(screen.getByText('Human Input Node')).toBeInTheDocument()
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('should show/hide content when toggling expansion', async () => {
    const user = userEvent.setup()
    render(
      <ContentWrapper {...defaultProps} showExpandIcon={true} expanded={false}>
        {childContent}
      </ContentWrapper>,
    )

    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
    const expandToggle = screen.getByRole('button', { name: 'share.chat.expand' })
    expect(expandToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(expandToggle)
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'share.chat.collapse' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    await user.click(expandToggle)
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'share.chat.expand' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('should render children initially if expanded is true', () => {
    render(
      <ContentWrapper {...defaultProps} showExpandIcon={true} expanded={true}>
        {childContent}
      </ContentWrapper>,
    )

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'share.chat.collapse' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('should toggle content with Space and Enter', async () => {
    const user = userEvent.setup()
    render(
      <ContentWrapper {...defaultProps} showExpandIcon={true} expanded={false}>
        {childContent}
      </ContentWrapper>,
    )

    const expandToggle = screen.getByRole('button', { name: 'share.chat.expand' })
    expandToggle.focus()
    await user.keyboard(' ')
    expect(screen.getByTestId('child-content')).toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
  })
})
