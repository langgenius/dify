import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/client'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import Billing from '../index'

let currentBillingUrl: string | undefined = 'https://billing.example.com'
let isManager = true
let enableBilling = true

const mocks = vi.hoisted(() => ({
  request: vi.fn(() => new Promise(() => {})),
}))

vi.mock('@/service/base', () => ({
  request: mocks.request,
  sseGeneratorPost: vi.fn(),
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    isCurrentWorkspaceManager: isManager,
  }))
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableBilling,
  }),
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
  const { wrapper } = createConsoleQueryWrapper({ queryClient })

  return render(<Billing />, { wrapper })
}

describe('Billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentBillingUrl = 'https://billing.example.com'
    isManager = true
    enableBilling = true
  })

  it('renders the billing portal as a keyboard-accessible external link for workspace managers', async () => {
    const user = userEvent.setup()
    renderBilling()

    const billingLink = screen.getByRole('link', { name: /billing\.viewBillingTitle/ })
    expect(billingLink).toHaveAttribute('href', currentBillingUrl)
    expect(billingLink).toHaveAttribute('target', '_blank')
    expect(billingLink).toHaveAttribute('rel', 'noopener noreferrer')

    await user.tab()
    expect(billingLink).toHaveFocus()
  })

  it('hides the billing action from non-manager members', () => {
    isManager = false

    renderBilling()

    expect(screen.queryByText('billing.viewBillingTitle')).not.toBeInTheDocument()
  })

  it('hides the billing action when billing is disabled', () => {
    enableBilling = false

    renderBilling()

    expect(screen.queryByText('billing.viewBillingTitle')).not.toBeInTheDocument()
  })

  it('renders the billing action outside the tab order before the URL is available', async () => {
    const user = userEvent.setup()
    currentBillingUrl = undefined

    renderBilling()

    expect(screen.getByText('billing.viewBillingTitle')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /billing\.viewBillingTitle/ }),
    ).not.toBeInTheDocument()

    await user.tab()
    expect(document.body).toHaveFocus()
  })
})
