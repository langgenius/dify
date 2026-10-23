import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import PlanComp from '../index'

const getSubscription = vi.hoisted(() => vi.fn())

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'billing.subscription.get': getSubscription,
    }),
  }
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

const renderPlan = (
  educationStatus = { allow_refresh: false, is_student: false },
  role: 'normal' | 'owner' = 'normal',
) => {
  const { wrapper } = createConsoleQueryWrapper({
    educationStatus,
    currentWorkspace: { role },
    features: {
      education: { enabled: true },
      billing: { subscription: { plan: 'sandbox' } },
    },
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

beforeEach(() => getSubscription.mockReset())
afterEach(() => vi.restoreAllMocks())

describe('PlanComp education actions', () => {
  it('links eligible accounts to education verification', () => {
    renderPlan()

    const educationLink = screen.getByRole('link', { name: 'education.toVerified' })
    expect(educationLink).toHaveAttribute('href', '/education/verify')
  })

  it('hides education verification for a verified account that is not expiring', () => {
    renderPlan({ allow_refresh: false, is_student: true })

    expect(screen.queryByRole('link', { name: 'education.toVerified' })).not.toBeInTheDocument()
  })

  it('starts yearly education checkout for a verified Sandbox owner without duplicate requests', async () => {
    const user = userEvent.setup()
    const checkoutUrl = 'https://checkout.example.com/education'
    const navigate = vi.spyOn(window.location, 'href', 'set').mockImplementation(() => {})
    let finishRequest = () => {}
    const pendingRequest = new Promise<void>((resolve) => {
      finishRequest = resolve
    })
    getSubscription.mockImplementation(async () => {
      await pendingRequest
      return { url: checkoutUrl }
    })
    renderPlan({ allow_refresh: false, is_student: true }, 'owner')

    const discountButton = screen.getByRole('button', { name: 'education.useEducationDiscount' })
    await user.click(discountButton)

    expect(getSubscription).toHaveBeenCalledWith({
      query: { plan: 'professional', interval: 'year' },
    })
    expect(discountButton).toBeDisabled()
    await user.click(discountButton)
    expect(getSubscription).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishRequest()
      await pendingRequest
    })

    expect(navigate).toHaveBeenCalledWith(checkoutUrl)
    expect(discountButton).toBeEnabled()
  })
})
