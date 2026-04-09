import { render, screen } from '@testing-library/react'
import { ExternalLinkIndicator, MenuItemContent } from '../menu-item-content'

describe('MenuItemContent', () => {
  it('should render the icon, label, and trailing content', () => {
    const { container } = render(
      <MenuItemContent
        iconClassName="i-ri-settings-4-line"
        label="Settings"
        trailing={<span data-testid="menu-trailing">Soon</span>}
      />,
    )

    expect(screen.getByText('Settings')).toBeInTheDocument()
    expect(screen.getByTestId('menu-trailing')).toHaveTextContent('Soon')
    expect(container.querySelector('.i-ri-settings-4-line')).toBeInTheDocument()
  })
})

describe('ExternalLinkIndicator', () => {
  it('should render the external-link icon with aria-hidden semantics', () => {
    const { container } = render(<ExternalLinkIndicator />)

    const indicator = container.querySelector('.i-ri-arrow-right-up-line')
    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveAttribute('aria-hidden')
  })
})
