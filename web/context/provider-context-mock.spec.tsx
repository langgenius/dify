import type { UsagePlanInfo } from '@/app/components/billing/type'
import { render } from '@testing-library/react'
import { createMockPlan, createMockPlanReset, createMockPlanTotal, createMockPlanUsage } from '@/__mocks__/provider-context'
import { Plan } from '@/app/components/billing/type'
import ProviderContextMock from './provider-context-mock'

let mockPlan: Plan = Plan.sandbox
const usage: UsagePlanInfo = {
  vectorSpace: 1,
  buildApps: 10,
  teamMembers: 1,
  annotatedResponse: 1,
  documentsUploadQuota: 0,
  apiRateLimit: 0,
  triggerEvents: 0,
}

const total: UsagePlanInfo = {
  vectorSpace: 100,
  buildApps: 100,
  teamMembers: 10,
  annotatedResponse: 100,
  documentsUploadQuota: 0,
  apiRateLimit: 0,
  triggerEvents: 0,
}

const reset = {
  apiRateLimit: 100,
  triggerEvents: 100,
}

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => {
    const withPlan = createMockPlan(mockPlan)
    const withUsage = createMockPlanUsage(usage, withPlan)
    const withTotal = createMockPlanTotal(total, withUsage)
    const withReset = createMockPlanReset(reset, withTotal)
    return withReset
  },
}))

const renderWithPlan = (plan: Plan) => {
  mockPlan = plan
  return render(<ProviderContextMock />)
}

describe('ProviderContextMock', () => {
  beforeEach(() => {
    mockPlan = Plan.sandbox
    vi.clearAllMocks()
  })
  it('should display sandbox plan type when mocked with sandbox plan', async () => {
    const { getByTestId } = renderWithPlan(Plan.sandbox)
    expect(getByTestId('plan-type').textContent).toBe(Plan.sandbox)
  })
  it('should display team plan type when mocked with team plan', () => {
    const { getByTestId } = renderWithPlan(Plan.team)
    expect(getByTestId('plan-type').textContent).toBe(Plan.team)
  })
  it('should provide usage info from mocked plan', () => {
    const { getByTestId } = renderWithPlan(Plan.team)
    const buildApps = getByTestId('plan-usage-build-apps').textContent

    expect(Number(buildApps as string)).toEqual(usage.buildApps)
  })

  it('should provide total info from mocked plan', () => {
    const { getByTestId } = renderWithPlan(Plan.team)
    const buildApps = getByTestId('plan-total-build-apps').textContent

    expect(Number(buildApps as string)).toEqual(total.buildApps)
  })

  it('should provide reset info from mocked plan', () => {
    const { getByTestId } = renderWithPlan(Plan.team)
    const apiRateLimit = getByTestId('plan-reset-api-rate-limit').textContent

    expect(Number(apiRateLimit as string)).toEqual(reset.apiRateLimit)
  })
})
