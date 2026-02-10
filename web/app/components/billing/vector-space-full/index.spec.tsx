import { render, screen } from '@testing-library/react'
import VectorSpaceFull from './index'

type VectorProviderGlobal = typeof globalThis & {
  __vectorProviderContext?: ReturnType<typeof vi.fn>
}

function getVectorGlobal(): VectorProviderGlobal {
  return globalThis as VectorProviderGlobal
}

vi.mock('@/context/provider-context', () => {
  const mock = vi.fn()
  getVectorGlobal().__vectorProviderContext = mock
  return {
    useProviderContext: () => mock(),
  }
})

vi.mock('../upgrade-btn', () => ({
  default: () => <button data-testid="vector-upgrade-btn" type="button">Upgrade</button>,
}))

// Mock utils to control threshold and plan limits
vi.mock('../utils', () => ({
  getPlanVectorSpaceLimitMB: (planType: string) => {
    // Return 5 for sandbox (threshold) and 100 for team
    if (planType === 'sandbox')
      return 5
    if (planType === 'team')
      return 100
    return 0
  },
}))

describe('VectorSpaceFull', () => {
  const planMock = {
    type: 'team',
    usage: {
      vectorSpace: 8,
    },
    total: {
      vectorSpace: 10,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    const globals = getVectorGlobal()
    globals.__vectorProviderContext?.mockReturnValue({
      plan: planMock,
    })
  })

  it('renders tip text and upgrade button', () => {
    render(<VectorSpaceFull />)

    expect(screen.getByText('billing.vectorSpace.fullTip')).toBeInTheDocument()
    expect(screen.getByText('billing.vectorSpace.fullSolution')).toBeInTheDocument()
    expect(screen.getByTestId('vector-upgrade-btn')).toBeInTheDocument()
  })

  it('shows vector usage and total', () => {
    render(<VectorSpaceFull />)

    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('100MB')).toBeInTheDocument()
  })
})
