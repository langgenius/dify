import { screen } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import PlanComp from '../index'

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    isCurrentWorkspaceManager: false,
  }))
})

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

  const { wrapper: UrlState } = createNuqsTestWrapper()
  return render(
    <UrlState>
      <PlanComp loc="billing-page" />
    </UrlState>,
    { wrapper },
  )
}

describe('PlanComp education verification entry', () => {
  it('links eligible accounts to education verification', () => {
    renderPlan()

    const educationLink = screen.getByRole('link', { name: 'education.toVerified' })
    expect(educationLink).toHaveAttribute('href', '/education/verify')
  })

  it('hides education verification for a verified account that is not expiring', () => {
    renderPlan({ allow_refresh: false, is_student: true })

    expect(screen.queryByRole('link', { name: 'education.toVerified' })).not.toBeInTheDocument()
  })
})
