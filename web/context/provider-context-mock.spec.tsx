import { render, screen, waitFor } from '@testing-library/react'
import { Plan } from '@/app/components/billing/type'
import ProviderContextMock from './provider-context-mock'
import { createMockPlan } from '@/__mocks__/provider-context'

let mockPlan: Plan = Plan.sandbox
jest.mock('@/context/provider-context', () => ({
  useProviderContext: () => {
    return createMockPlan(mockPlan)
  },
}))

const renderWithPlan = (plan: Plan) => {
  mockPlan = plan
  return render(<ProviderContextMock />)
}

describe('mock plan', () => {
  beforeEach(() => {
    mockPlan = Plan.sandbox
    jest.clearAllMocks()
  })
  it('mock sandbox plan', async () => {
    renderWithPlan(Plan.sandbox)
    await waitFor(() => expect(screen.getByTestId('plan-type').textContent).toBe(Plan.sandbox))
  })
  it('mock pro plan', () => {
    const { getByTestId } = renderWithPlan(Plan.professional)
    expect(getByTestId('plan-type').textContent).toBe(Plan.professional)
  })
})
