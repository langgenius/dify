import { fireEvent, render, screen } from '@testing-library/react'
import { Plan } from '../../type'
import HeaderBillingBtn from '../index'

type HeaderGlobal = typeof globalThis & {
  __mockProviderContext?: ReturnType<typeof vi.fn>
}

function getHeaderGlobal(): HeaderGlobal {
  return globalThis as HeaderGlobal
}

const ensureProviderContextMock = () => {
  const globals = getHeaderGlobal()
  if (!globals.__mockProviderContext)
    throw new Error('Provider context mock not set')
  return globals.__mockProviderContext
}

vi.mock('@/context/provider-context', () => {
  const mock = vi.fn()
  const globals = getHeaderGlobal()
  globals.__mockProviderContext = mock
  return {
    useProviderContext: () => mock(),
  }
})

vi.mock('../../upgrade-btn', () => ({
  default: () => <button data-testid="upgrade-btn" type="button">Upgrade</button>,
}))

describe('HeaderBillingBtn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureProviderContextMock().mockReturnValue({
      plan: {
        type: Plan.professional,
      },
      enableBilling: true,
      isFetchedPlan: true,
    })
  })

  it('renders nothing when billing is disabled or plan is not fetched', () => {
    ensureProviderContextMock().mockReturnValueOnce({
      plan: {
        type: Plan.professional,
      },
      enableBilling: false,
      isFetchedPlan: true,
    })

    const { container } = render(<HeaderBillingBtn />)

    expect(container.firstChild).toBeNull()
  })

  it('renders upgrade button for sandbox plan', () => {
    ensureProviderContextMock().mockReturnValueOnce({
      plan: {
        type: Plan.sandbox,
      },
      enableBilling: true,
      isFetchedPlan: true,
    })

    render(<HeaderBillingBtn />)

    expect(screen.getByTestId('upgrade-btn')).toBeInTheDocument()
  })

  it('renders team badge for team plan', () => {
    ensureProviderContextMock().mockReturnValueOnce({
      plan: { type: Plan.team },
      enableBilling: true,
      isFetchedPlan: true,
    })

    render(<HeaderBillingBtn />)

    expect(screen.getByText('team')).toBeInTheDocument()
  })

  it('renders nothing when plan is not fetched', () => {
    ensureProviderContextMock().mockReturnValueOnce({
      plan: { type: Plan.professional },
      enableBilling: true,
      isFetchedPlan: false,
    })

    const { container } = render(<HeaderBillingBtn />)
    expect(container.firstChild).toBeNull()
  })

  it('renders sandbox upgrade btn with undefined onClick in display-only mode', () => {
    ensureProviderContextMock().mockReturnValueOnce({
      plan: { type: Plan.sandbox },
      enableBilling: true,
      isFetchedPlan: true,
    })

    render(<HeaderBillingBtn isDisplayOnly />)
    expect(screen.getByTestId('upgrade-btn')).toBeInTheDocument()
  })

  it('renders plan badge and forwards clicks when not display-only', () => {
    const onClick = vi.fn()

    const { rerender } = render(<HeaderBillingBtn onClick={onClick} />)

    const badge = screen.getByText('pro').closest('div')!
    fireEvent.click(badge)
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(<HeaderBillingBtn onClick={onClick} isDisplayOnly />)
    fireEvent.click(screen.getByText('pro').closest('div')!)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
