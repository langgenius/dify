import { render, screen } from '@testing-library/react'
import { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import MarketplaceSection from '../marketplace-section'

const defaultProps = {
  marketplaceProviders: [ModelProviderQuotaGetPaid.OPENAI, ModelProviderQuotaGetPaid.ANTHROPIC],
  marketplaceCollapsed: false,
  installingProvider: null,
  canInstallPlugin: true,
  onMarketplaceCollapsedChange: vi.fn(),
  onInstallPlugin: vi.fn(),
}

describe('MarketplaceSection', () => {
  it('keeps the install action named and focusable while it is pending', () => {
    const { rerender } = render(<MarketplaceSection {...defaultProps} />)
    const installButton = screen.getByRole('button', {
      name: 'common.modelProvider.selector.install OpenAI',
    })
    expect(
      screen.getByRole('button', {
        name: 'common.modelProvider.selector.install Anthropic',
      }),
    ).toBeInTheDocument()
    installButton.focus()

    rerender(
      <MarketplaceSection
        {...defaultProps}
        installingProvider={ModelProviderQuotaGetPaid.OPENAI}
      />,
    )

    expect(installButton).toHaveAccessibleName('plugin.installModal.installing OpenAI')
    expect(installButton).toHaveAttribute('aria-disabled', 'true')
    expect(installButton).not.toHaveAttribute('aria-busy')
    expect(installButton).toHaveFocus()
  })
})
