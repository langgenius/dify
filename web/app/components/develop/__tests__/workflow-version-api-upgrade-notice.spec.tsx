import { fireEvent, render, screen, within } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import {
  WorkflowVersionApiContent,
  WorkflowVersionApiUpgradeNotice,
} from '../workflow-version-api-upgrade-notice'

let mockPlanType = Plan.professional
let mockEnableBilling = true
let mockIsFetchedPlan = true

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: { type: mockPlanType },
    enableBilling: mockEnableBilling,
    isFetchedPlan: mockIsFetchedPlan,
  }),
}))

vi.mock('@/app/components/billing/plan-upgrade-modal', () => ({
  PlanUpgradeModal: ({
    show,
    title,
    description,
    onClose,
  }: {
    show: boolean
    title: string
    description: string
    onClose: () => void
  }) =>
    show ? (
      <div data-testid="plan-upgrade-modal">
        <div>{title}</div>
        <div>{description}</div>
        <button type="button" onClick={onClose}>
          close upgrade modal
        </button>
      </div>
    ) : null,
}))

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: ({
    onClick,
    isShort,
    size,
    loc,
    className,
  }: {
    onClick: () => void
    isShort: boolean
    size: string
    loc: string
    className: string
  }) => (
    <button
      type="button"
      data-is-short={isShort}
      data-size={size}
      data-loc={loc}
      className={className}
      onClick={onClick}
    >
      billing.upgradeBtn.encourageShort
    </button>
  ),
}))

describe('WorkflowVersionApiUpgradeNotice', () => {
  beforeEach(() => {
    mockPlanType = Plan.professional
    mockEnableBilling = true
    mockIsFetchedPlan = true
  })

  it('should not render before the plan is fetched', () => {
    mockPlanType = Plan.sandbox
    mockIsFetchedPlan = false

    render(<WorkflowVersionApiUpgradeNotice />)

    expect(
      screen.queryByRole('button', { name: 'billing.upgradeBtn.encourageShort' }),
    ).not.toBeInTheDocument()
  })

  it('should not render when billing is disabled', () => {
    mockPlanType = Plan.sandbox
    mockEnableBilling = false

    render(<WorkflowVersionApiUpgradeNotice />)

    expect(
      screen.queryByRole('button', { name: 'billing.upgradeBtn.encourageShort' }),
    ).not.toBeInTheDocument()
  })

  it('should not render for paid plans', () => {
    render(<WorkflowVersionApiUpgradeNotice />)

    expect(
      screen.queryByRole('button', { name: 'billing.upgradeBtn.encourageShort' }),
    ).not.toBeInTheDocument()
  })

  it('should show a small upgrade button and open the plan upgrade modal for sandbox plans', () => {
    mockPlanType = Plan.sandbox

    render(<WorkflowVersionApiUpgradeNotice />)

    expect(screen.queryByText('billing.upgrade.workflowVersionRun.title')).not.toBeInTheDocument()
    expect(
      screen.queryByText('billing.upgrade.workflowVersionRun.description'),
    ).not.toBeInTheDocument()

    const upgradeButton = screen.getByRole('button', { name: 'billing.upgradeBtn.encourageShort' })
    expect(upgradeButton).toHaveAttribute('data-is-short', 'true')
    expect(upgradeButton).toHaveAttribute('data-size', 'custom')
    expect(upgradeButton).toHaveAttribute('data-loc', 'workflow-version-api-docs')
    expect(upgradeButton).toHaveClass('h-5!', 'rounded-md!', 'px-1!')

    fireEvent.click(upgradeButton)

    const modal = screen.getByTestId('plan-upgrade-modal')
    expect(modal).toBeInTheDocument()
    expect(within(modal).getByText('billing.upgrade.workflowVersionRun.title')).toBeInTheDocument()
    expect(
      within(modal).getByText('billing.upgrade.workflowVersionRun.description'),
    ).toBeInTheDocument()
  })
})

describe('WorkflowVersionApiContent', () => {
  beforeEach(() => {
    mockPlanType = Plan.professional
    mockEnableBilling = true
    mockIsFetchedPlan = true
  })

  it('should hide content while the billing plan is loading', () => {
    mockIsFetchedPlan = false

    render(<WorkflowVersionApiContent>paid API details</WorkflowVersionApiContent>)

    expect(screen.queryByText('paid API details')).not.toBeInTheDocument()
  })

  it('should hide content for sandbox plans', () => {
    mockPlanType = Plan.sandbox

    const { container } = render(
      <>
        <h2>paid API</h2>
        <WorkflowVersionApiContent>paid API details</WorkflowVersionApiContent>
        <hr />
      </>,
    )

    expect(screen.queryByText('paid API details')).not.toBeInTheDocument()
    expect(container.querySelector('h2 + [aria-hidden="true"] + hr')).toBeInTheDocument()
  })

  it('should show content for paid plans', () => {
    render(<WorkflowVersionApiContent>paid API details</WorkflowVersionApiContent>)

    expect(screen.getByText('paid API details')).toBeInTheDocument()
  })

  it('should show content when billing is disabled', () => {
    mockPlanType = Plan.sandbox
    mockEnableBilling = false
    mockIsFetchedPlan = false

    render(<WorkflowVersionApiContent>paid API details</WorkflowVersionApiContent>)

    expect(screen.getByText('paid API details')).toBeInTheDocument()
  })
})
