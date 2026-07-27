import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import UpgradeCard from '../upgrade-card'

const mockSetShowPricingModal = vi.fn()

const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: { deployment_edition: 'CLOUD' } })

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({ setShowPricingModal: mockSetShowPricingModal }),
}))

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      upgrade
    </button>
  ),
}))

describe('UpgradeCard', () => {
  it('opens pricing from the upgrade action', async () => {
    const user = userEvent.setup()
    render(<UpgradeCard />)

    await user.click(screen.getByRole('button', { name: 'upgrade' }))

    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
  })
})
