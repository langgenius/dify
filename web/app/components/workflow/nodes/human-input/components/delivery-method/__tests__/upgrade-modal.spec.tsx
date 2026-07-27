import { fireEvent, screen } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { UpgradeModal } from '../upgrade-modal'

const render = (ui: React.ReactElement) =>
  renderWithConsoleQuery(ui, { systemFeatures: { deployment_edition: 'CLOUD' } })

const mockUseModalContextSelector = vi.hoisted(() => vi.fn())

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (state: { setShowPricingModal: () => void }) => () => void) =>
    mockUseModalContextSelector(selector),
}))

describe('human-input/delivery-method/upgrade-modal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render upgrade copy and handle hide and upgrade actions', () => {
    const handleClose = vi.fn()
    const handleShowPricingModal = vi.fn()

    mockUseModalContextSelector.mockImplementation((selector) =>
      selector({
        setShowPricingModal: handleShowPricingModal,
      }),
    )

    render(<UpgradeModal open onOpenChange={handleClose} />)

    expect(
      screen.getByText('workflow.nodes.humanInput.deliveryMethod.upgradeTip'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('workflow.nodes.humanInput.deliveryMethod.upgradeTipContent'),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'workflow.nodes.humanInput.deliveryMethod.upgradeTipHide',
      }),
    )
    expect(handleClose).toHaveBeenCalledWith(false)

    fireEvent.click(screen.getByRole('button', { name: /billing.upgradeBtn.encourageShort/i }))
    expect(handleShowPricingModal).toHaveBeenCalledTimes(1)
  })
})
