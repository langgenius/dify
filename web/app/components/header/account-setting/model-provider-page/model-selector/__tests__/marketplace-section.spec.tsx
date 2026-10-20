import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('keeps the install action named and focused while preventing repeat installation', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<MarketplaceSection {...defaultProps} />)
    const installButton = screen.getByRole('button', {
      name: 'modelProvider.modelProvider.selector.install OpenAI',
    })
    expect(
      screen.getByRole('button', {
        name: 'modelProvider.modelProvider.selector.install Anthropic',
      }),
    ).toBeInTheDocument()
    await user.click(installButton)
    expect(defaultProps.onInstallPlugin).toHaveBeenCalledWith(ModelProviderQuotaGetPaid.OPENAI)

    rerender(
      <MarketplaceSection
        {...defaultProps}
        installingProvider={ModelProviderQuotaGetPaid.OPENAI}
      />,
    )

    expect(installButton).toHaveAccessibleName('plugin.installModal.installing OpenAI')
    expect(installButton).toHaveAttribute('aria-disabled', 'true')
    expect(installButton).toHaveFocus()
    await user.click(installButton)
    expect(defaultProps.onInstallPlugin).toHaveBeenCalledTimes(1)
  })
})
