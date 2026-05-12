import { render, screen } from '@testing-library/react'
import TriggerEventsLimitModal from '../index'

const mockOnClose = vi.fn()
const mockOnUpgrade = vi.fn()

describe('TriggerEventsLimitModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the trigger usage props to the upgrade modal', () => {
    render(
      <TriggerEventsLimitModal
        show
        onClose={mockOnClose}
        onUpgrade={mockOnUpgrade}
        usage={12}
        total={20}
        resetInDays={5}
      />,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('billing.triggerLimitModal.title')).toBeInTheDocument()
    expect(screen.getByText('billing.triggerLimitModal.description')).toBeInTheDocument()
    expect(screen.getByText('billing.triggerLimitModal.usageTitle'))!.toBeInTheDocument()
    expect(screen.getByText('12'))!.toBeInTheDocument()
    expect(screen.getByText('20'))!.toBeInTheDocument()
  })

  it('renders even when trigger modal is hidden', () => {
    render(
      <TriggerEventsLimitModal
        show={false}
        onClose={mockOnClose}
        onUpgrade={mockOnUpgrade}
        usage={0}
        total={0}
      />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders reset info when resetInDays is provided', () => {
    render(
      <TriggerEventsLimitModal
        show
        onClose={mockOnClose}
        onUpgrade={mockOnUpgrade}
        usage={18000}
        total={20000}
        resetInDays={7}
      />,
    )

    expect(screen.getByText('billing.triggerLimitModal.usageTitle'))!.toBeInTheDocument()
    expect(screen.getByText('18000'))!.toBeInTheDocument()
    expect(screen.getByText('20000'))!.toBeInTheDocument()
  })

  it('passes correct title and description translations', () => {
    render(
      <TriggerEventsLimitModal
        show
        onClose={mockOnClose}
        onUpgrade={mockOnUpgrade}
        usage={0}
        total={0}
      />,
    )

    expect(screen.getByText('billing.triggerLimitModal.title')).toBeInTheDocument()
    expect(screen.getByText('billing.triggerLimitModal.description')).toBeInTheDocument()
  })

  it('passes onClose and onUpgrade callbacks to PlanUpgradeModal', () => {
    render(
      <TriggerEventsLimitModal
        show
        onClose={mockOnClose}
        onUpgrade={mockOnUpgrade}
        usage={0}
        total={0}
      />,
    )

    screen.getByText('billing.triggerLimitModal.dismiss').click()
    expect(mockOnClose).toHaveBeenCalledTimes(1)

    screen.getByText('billing.triggerLimitModal.upgrade').click()
    expect(mockOnUpgrade).toHaveBeenCalledTimes(1)
  })
})
