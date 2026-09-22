import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import UpgradeCard from '../upgrade-card'

const onPricingUrlUpdate = vi.hoisted(() => vi.fn())

const renderWithoutPricing = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: { deployment_edition: 'CLOUD' } })

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      upgrade
    </button>
  ),
}))

function render(...args: Parameters<typeof renderWithoutPricing>) {
  args[0] = <NuqsTestingAdapter onUrlUpdate={onPricingUrlUpdate}>{args[0]}</NuqsTestingAdapter>
  return renderWithoutPricing(...args)
}

describe('UpgradeCard', () => {
  it('opens pricing from the upgrade action', async () => {
    const user = userEvent.setup()
    render(<UpgradeCard />)

    await user.click(screen.getByRole('button', { name: 'upgrade' }))

    await waitFor(() =>
      expect(onPricingUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open'),
    )
  })
})
