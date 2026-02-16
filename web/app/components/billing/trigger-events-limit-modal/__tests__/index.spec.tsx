import { render, screen } from '@testing-library/react'
import TriggerEventsLimitModal from '../index'

const mockOnClose = vi.fn()
const mockOnUpgrade = vi.fn()

const planUpgradeModalMock = vi.fn((props: { show: boolean, title: string, description: string, extraInfo?: React.ReactNode, onClose: () => void, onUpgrade: () => void }) => (
  <div
    data-testid="plan-upgrade-modal"
    data-show={props.show}
    data-title={props.title}
    data-description={props.description}
  >
    {props.extraInfo}
  </div>
))

vi.mock('@/app/components/billing/plan-upgrade-modal', () => ({
  default: (props: { show: boolean, title: string, description: string, extraInfo?: React.ReactNode, onClose: () => void, onUpgrade: () => void }) => planUpgradeModalMock(props),
}))

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

    const modal = screen.getByTestId('plan-upgrade-modal')
    expect(modal.getAttribute('data-show')).toBe('true')
    expect(modal.getAttribute('data-title')).toContain('billing.triggerLimitModal.title')
    expect(modal.getAttribute('data-description')).toContain('billing.triggerLimitModal.description')
    expect(planUpgradeModalMock).toHaveBeenCalled()

    const passedProps = planUpgradeModalMock.mock.calls[0][0]
    expect(passedProps.onClose).toBe(mockOnClose)
    expect(passedProps.onUpgrade).toBe(mockOnUpgrade)

    expect(screen.getByText('billing.triggerLimitModal.usageTitle')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
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

    expect(planUpgradeModalMock).toHaveBeenCalled()
    expect(screen.getByTestId('plan-upgrade-modal').getAttribute('data-show')).toBe('false')
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

    expect(screen.getByText('billing.triggerLimitModal.usageTitle')).toBeInTheDocument()
    expect(screen.getByText('18000')).toBeInTheDocument()
    expect(screen.getByText('20000')).toBeInTheDocument()
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

    const modal = screen.getByTestId('plan-upgrade-modal')
    expect(modal.getAttribute('data-title')).toBe('billing.triggerLimitModal.title')
    expect(modal.getAttribute('data-description')).toBe('billing.triggerLimitModal.description')
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

    const passedProps = planUpgradeModalMock.mock.calls[0][0]
    expect(passedProps.onClose).toBe(mockOnClose)
    expect(passedProps.onUpgrade).toBe(mockOnUpgrade)
  })
})
