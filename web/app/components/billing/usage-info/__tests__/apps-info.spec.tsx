import { render, screen } from '@testing-library/react'
import { defaultPlan } from '../../config'
import AppsInfo from '../apps-info'

const mockProviderContext = vi.fn()

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => mockProviderContext(),
}))

describe('AppsInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProviderContext.mockReturnValue({
      plan: {
        ...defaultPlan,
        usage: { ...defaultPlan.usage, buildApps: 7 },
        total: { ...defaultPlan.total, buildApps: 15 },
      },
    })
  })

  it('renders build apps usage information with context data', () => {
    render(<AppsInfo className="apps-info-class" />)

    expect(screen.getByText('billing.usagePage.buildApps')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('billing.usagePage.buildApps').closest('.apps-info-class')).toBeInTheDocument()
  })

  it('renders without className', () => {
    render(<AppsInfo />)

    expect(screen.getByText('billing.usagePage.buildApps')).toBeInTheDocument()
  })

  it('renders zero usage correctly', () => {
    mockProviderContext.mockReturnValue({
      plan: {
        ...defaultPlan,
        usage: { ...defaultPlan.usage, buildApps: 0 },
        total: { ...defaultPlan.total, buildApps: 5 },
      },
    })

    render(<AppsInfo />)

    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders when usage equals total (at capacity)', () => {
    mockProviderContext.mockReturnValue({
      plan: {
        ...defaultPlan,
        usage: { ...defaultPlan.usage, buildApps: 10 },
        total: { ...defaultPlan.total, buildApps: 10 },
      },
    })

    render(<AppsInfo />)

    const tens = screen.getAllByText('10')
    expect(tens.length).toBe(2)
  })
})
