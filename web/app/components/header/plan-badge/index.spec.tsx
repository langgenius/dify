import type { Mock } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { createMockProviderContextValue } from '@/__mocks__/provider-context'
import { useProviderContext } from '@/context/provider-context'
import { Plan } from '../../billing/type'
import PlanBadge from './index'

vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
  baseProviderContextValue: {},
}))

describe('PlanBadge', () => {
  const mockUseProviderContext = useProviderContext as Mock

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null if isFetchedPlan is false', () => {
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({ isFetchedPlan: false }),
    )
    const { container } = render(<PlanBadge plan={Plan.sandbox} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render upgrade badge when plan is sandbox and sandboxAsUpgrade is true', () => {
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({ isFetchedPlan: true }),
    )
    render(<PlanBadge plan={Plan.sandbox} sandboxAsUpgrade={true} />)
    expect(
      screen.getByText('billing.upgradeBtn.encourageShort'),
    ).toBeInTheDocument()
  })

  it('should render sandbox badge when plan is sandbox and sandboxAsUpgrade is false', () => {
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({ isFetchedPlan: true }),
    )
    render(<PlanBadge plan={Plan.sandbox} sandboxAsUpgrade={false} />)
    expect(screen.getByText(Plan.sandbox)).toBeInTheDocument()
  })

  it('should render professional badge when plan is professional', () => {
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({ isFetchedPlan: true }),
    )
    render(<PlanBadge plan={Plan.professional} />)
    expect(screen.getByText('pro')).toBeInTheDocument()
  })

  it('should render graduation icon when isEducationWorkspace is true and plan is professional', () => {
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({
        isFetchedPlan: true,
        isEducationWorkspace: true,
      }),
    )
    const { container } = render(<PlanBadge plan={Plan.professional} />)

    expect(container.querySelector('svg')).toBeInTheDocument()
    expect(screen.getByText('pro')).toBeInTheDocument()
  })

  it('should render team badge when plan is team', () => {
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({ isFetchedPlan: true }),
    )
    render(<PlanBadge plan={Plan.team} />)
    expect(screen.getByText(Plan.team)).toBeInTheDocument()
  })

  it('should return null when plan is enterprise', () => {
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({ isFetchedPlan: true }),
    )
    const { container } = render(<PlanBadge plan={Plan.enterprise} />)
    expect(container.firstChild).toBeNull()
  })

  it('should trigger onClick when clicked', () => {
    const handleClick = vi.fn()
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({ isFetchedPlan: true }),
    )
    render(<PlanBadge plan={Plan.team} onClick={handleClick} />)
    fireEvent.click(screen.getByText(Plan.team))
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('should handle allowHover prop', () => {
    mockUseProviderContext.mockReturnValue(
      createMockProviderContextValue({ isFetchedPlan: true }),
    )
    const { container } = render(
      <PlanBadge plan={Plan.team} allowHover={true} />,
    )

    expect(container.firstChild).not.toBeNull()
  })
})
