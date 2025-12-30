import { render, screen } from '@testing-library/react'
import { defaultPlan } from '../config'
import AppsInfo from './apps-info'

const appsUsage = 7
const appsTotal = 15

const mockPlan = {
  ...defaultPlan,
  usage: {
    ...defaultPlan.usage,
    buildApps: appsUsage,
  },
  total: {
    ...defaultPlan.total,
    buildApps: appsTotal,
  },
}

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: mockPlan,
  }),
}))

describe('AppsInfo', () => {
  it('renders build apps usage information with context data', () => {
    render(<AppsInfo className="apps-info-class" />)

    expect(screen.getByText('billing.usagePage.buildApps')).toBeInTheDocument()
    expect(screen.getByText(`${appsUsage}`)).toBeInTheDocument()
    expect(screen.getByText(`${appsTotal}`)).toBeInTheDocument()
    expect(screen.getByText('billing.usagePage.buildApps').closest('.apps-info-class')).toBeInTheDocument()
  })
})
