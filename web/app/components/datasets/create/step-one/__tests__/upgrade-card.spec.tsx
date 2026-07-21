import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UpgradeCard from '../upgrade-card'

const mockSetShowPricingModal = vi.fn()

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  IS_CLOUD_EDITION: true,
}))

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
