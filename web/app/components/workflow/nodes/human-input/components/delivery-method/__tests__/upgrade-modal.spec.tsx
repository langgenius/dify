import { fireEvent, render, screen } from '@testing-library/react'
import { UpgradeModal } from '../upgrade-modal'

const mockUseModalContextSelector = vi.hoisted(() => vi.fn())

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (state: { setShowPricingModal: () => void }) => () => void) =>
    mockUseModalContextSelector(selector),
}))

vi.mock('@/app/components/base/premium-badge', () => ({
  __esModule: true,
  default: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

describe('human-input/delivery-method/upgrade-modal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render upgrade copy and handle hide and upgrade actions', () => {
    const handleClose = vi.fn()
    const handleShowPricingModal = vi.fn()

    mockUseModalContextSelector.mockImplementation(selector => selector({
      setShowPricingModal: handleShowPricingModal,
    }))

    render(
      <UpgradeModal
        open
        onOpenChange={handleClose}
      />,
    )

    expect(screen.getByText('workflow.nodes.humanInput.deliveryMethod.upgradeTip')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.humanInput.deliveryMethod.upgradeTipContent')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'workflow.nodes.humanInput.deliveryMethod.upgradeTipHide' }))
    expect(handleClose).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: /billing.upgradeBtn.encourageShort/i }))
    expect(handleShowPricingModal).toHaveBeenCalledTimes(1)
  })
})
