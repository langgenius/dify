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
        <div data-testid="child-content">Child Content</div>
      </ContentWrapper>,
    )

  it('should render node title and children by default when not collapsible', () => {
    renderContentWrapper()

    expect(screen.getByText('Human Input Node')).toBeInTheDocument()
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('should show/hide content when toggling expansion', async () => {
    const user = userEvent.setup()
    renderContentWrapper({ showExpandIcon: true, expanded: false })

    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
    const expandToggle = screen.getByRole('button', {
      name: 'share.chat.expand Human Input Node',
    })
    expect(expandToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(expandToggle)
    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    const collapseToggle = screen.getByRole('button', {
      name: 'share.chat.collapse Human Input Node',
    })
    expect(collapseToggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(collapseToggle)
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument()
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('should expand with the %s key', async (_, key) => {
    const user = userEvent.setup()
    renderContentWrapper({ showExpandIcon: true, expanded: false })

    const expandToggle = screen.getByRole('button', {
      name: 'share.chat.expand Human Input Node',
    })
    expandToggle.focus()
    await user.keyboard(key)

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
  })

  it('should render children initially if expanded is true', () => {
    renderContentWrapper({ showExpandIcon: true, expanded: true })

    expect(screen.getByTestId('child-content')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'share.chat.collapse Human Input Node' }),
    ).toHaveAttribute('aria-expanded', 'true')
  })
})
