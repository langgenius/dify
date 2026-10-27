import { act, screen } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import Billing from '../index'

let currentBillingUrl: string | undefined = 'https://billing.example.com'
let isManager = true
let deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'CLOUD'

const mocks = vi.hoisted(() => ({
  request: vi.fn(() => new Promise(() => {})),
}))

vi.mock('@/service/base', () => ({
  request: mocks.request,
  sseGeneratorPost: vi.fn(),
}))

vi.mock('../../plan', () => ({
  default: ({ loc }: { loc: string }) => <div data-testid="plan-component" data-loc={loc} />,
}))

const renderBilling = () => {
  const queryClient = createConsoleQueryClient()
  if (currentBillingUrl) {
    queryClient.setQueryData(consoleQuery.billing.invoices.get.queryOptions().queryKey, {
      url: currentBillingUrl,
    })
  }
  const { wrapper } = createConsoleQueryWrapper({
    queryClient,
    currentWorkspace: { role: isManager ? 'owner' : 'normal' },
    systemFeatures: { deployment_edition: deploymentEdition },
  })

  return { ...render(<Billing />, { wrapper }), queryClient }
}

describe('Billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentBillingUrl = 'https://billing.example.com'
    isManager = true
    deploymentEdition = 'CLOUD'
  })

  it('hides the billing action from non-manager members', () => {
    isManager = false

    renderBilling()

    expect(screen.queryByText('billing.viewBillingTitle')).not.toBeInTheDocument()
  })

  it('hides the billing action when billing is disabled', () => {
    deploymentEdition = 'COMMUNITY'

    renderBilling()

    expect(screen.queryByText('billing.viewBillingTitle')).not.toBeInTheDocument()
  })

  it('enables the manager billing link only after its URL becomes available', async () => {
    currentBillingUrl = undefined

    const { queryClient } = renderBilling()

    expect(screen.getByText('billing.viewBillingTitle')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /billing\.viewBillingTitle/ }),
    ).not.toBeInTheDocument()

    act(() =>
      queryClient.setQueryData(consoleQuery.billing.invoices.get.queryOptions().queryKey, {
        url: 'https://billing.example.com',
      }),
    )
    const link = await screen.findByRole('link', { name: /billing\.viewBillingTitle/ })
    expect(link).toHaveAttribute('href', 'https://billing.example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
