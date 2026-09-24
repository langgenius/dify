import { screen } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import PlanComp from '../index'

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    isCurrentWorkspaceManager: false,
  }))
})

vi.mock('@/app/components/billing/upgrade-btn', () => ({
  default: () => <button type="button">View Plan</button>,
}))

vi.mock('@/app/components/billing/usage-info', () => ({
  default: () => null,
}))

vi.mock('@/app/components/billing/usage-info/vector-space-info', () => ({
  default: () => null,
}))

vi.mock('../assets', () => ({
  Professional: () => null,
  Sandbox: () => null,
  Team: () => null,
}))

const renderPlan = (educationStatus = { allow_refresh: false, is_student: false }) => {
  const { wrapper } = createConsoleQueryWrapper({
    educationStatus,
    features: { education: { enabled: true } },
    systemFeatures: { deployment_edition: 'CLOUD' },
  })

  return render(<PlanComp loc="billing-page" />, { wrapper })
}

describe('PlanComp education verification entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows education verification before View Plan when the original eligibility allows it', () => {
    renderPlan()

    const educationLink = screen.getByRole('link', { name: 'education.toVerified' })
    const viewPlanButton = screen.getByRole('button', { name: 'View Plan' })

    expect(
      educationLink.compareDocumentPosition(viewPlanButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(educationLink).toHaveAttribute('href', '/education/verify')
  })

  it('hides education verification for a verified account that is not expiring', () => {
    renderPlan({ allow_refresh: false, is_student: true })

    expect(screen.queryByRole('link', { name: 'education.toVerified' })).not.toBeInTheDocument()
  })
})
