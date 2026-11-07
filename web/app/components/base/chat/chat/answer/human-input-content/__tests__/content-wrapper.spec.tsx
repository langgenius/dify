import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vite-plus/test'
import ContentWrapper from '../content-wrapper'

describe('ContentWrapper', () => {
  const renderContentWrapper = (
    props: Omit<ComponentProps<typeof ContentWrapper>, 'children' | 'nodeTitle'> = {},
  ) =>
    render(
      <ContentWrapper nodeTitle="Human Input Node" {...props}>
        <div>Child Content</div>
      </ContentWrapper>,
    )

  it('should render node title and children by default when not collapsible', () => {
    renderContentWrapper()

    expect(screen.getByText('Human Input Node')).toBeInTheDocument()
    expect(screen.getByText('Child Content')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('should show/hide content when toggling expansion', async () => {
    const user = userEvent.setup()
    renderContentWrapper({ showExpandIcon: true, expanded: false })

    expect(screen.queryByText('Child Content')).not.toBeInTheDocument()
    const expandToggle = screen.getByRole('button', {
      name: 'share.chat.expand Human Input Node',
    })
    expect(expandToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(expandToggle)
    expect(screen.getByText('Child Content')).toBeInTheDocument()
    const collapseToggle = screen.getByRole('button', {
      name: 'share.chat.collapse Human Input Node',
    })
    expect(collapseToggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(collapseToggle)
    expect(screen.queryByText('Child Content')).not.toBeInTheDocument()
  })
})
