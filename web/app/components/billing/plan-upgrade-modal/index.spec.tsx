import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import PlanUpgradeModal from './index'

const mockSetShowPricingModal = vi.fn()

vi.mock('@/app/components/base/modal', () => {
  const MockModal = ({ isShow, children }: { isShow: boolean, children: React.ReactNode }) => (
    isShow ? <div data-testid="plan-upgrade-modal">{children}</div> : null
  )
  return {
    default: MockModal,
  }
})

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowPricingModal: mockSetShowPricingModal,
  }),
}))

const baseProps = {
  title: 'Upgrade Required',
  description: 'You need to upgrade your plan.',
  show: true,
  onClose: vi.fn(),
}

const renderComponent = (props: Partial<React.ComponentProps<typeof PlanUpgradeModal>> = {}) => {
  const mergedProps = { ...baseProps, ...props }
  return render(<PlanUpgradeModal {...mergedProps} />)
}

describe('PlanUpgradeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering and props-driven content
  it('should render modal with provided content when visible', () => {
    // Arrange
    const extraInfoText = 'Additional upgrade details'
    renderComponent({
      extraInfo: <div>{extraInfoText}</div>,
    })

    // Assert
    expect(screen.getByText(baseProps.title)).toBeInTheDocument()
    expect(screen.getByText(baseProps.description)).toBeInTheDocument()
    expect(screen.getByText(extraInfoText)).toBeInTheDocument()
    expect(screen.getByText('billing.triggerLimitModal.dismiss')).toBeInTheDocument()
    expect(screen.getByText('billing.triggerLimitModal.upgrade')).toBeInTheDocument()
  })

  // Guard against rendering when modal is hidden
  it('should not render content when show is false', () => {
    // Act
    renderComponent({ show: false })

    // Assert
    expect(screen.queryByText(baseProps.title)).not.toBeInTheDocument()
    expect(screen.queryByText(baseProps.description)).not.toBeInTheDocument()
  })

  // User closes the modal from dismiss button
  it('should call onClose when dismiss button is clicked', async () => {
    // Arrange
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderComponent({ onClose })

    // Act
    await user.click(screen.getByText('billing.triggerLimitModal.dismiss'))

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // Upgrade path uses provided callback over pricing modal
  it('should call onUpgrade and onClose when upgrade button is clicked with onUpgrade provided', async () => {
    // Arrange
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onUpgrade = vi.fn()
    renderComponent({ onClose, onUpgrade })

    // Act
    await user.click(screen.getByText('billing.triggerLimitModal.upgrade'))

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onUpgrade).toHaveBeenCalledTimes(1)
    expect(mockSetShowPricingModal).not.toHaveBeenCalled()
  })

  // Fallback upgrade path opens pricing modal when no onUpgrade is supplied
  it('should open pricing modal when upgrade button is clicked without onUpgrade', async () => {
    // Arrange
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderComponent({ onClose, onUpgrade: undefined })

    // Act
    await user.click(screen.getByText('billing.triggerLimitModal.upgrade'))

    // Assert
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockSetShowPricingModal).toHaveBeenCalledTimes(1)
  })
})
