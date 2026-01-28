import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Billing from './index'

let currentBillingUrl: string | null = 'https://billing'
let fetching = false
let isManager = true
let enableBilling = true

const refetchMock = vi.fn()
const openAsyncWindowMock = vi.fn()

vi.mock('@/service/use-billing', () => ({
  useBillingUrl: () => ({
    data: currentBillingUrl,
    isFetching: fetching,
    refetch: refetchMock,
  }),
}))

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => openAsyncWindowMock,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: isManager,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableBilling,
  }),
}))

vi.mock('../plan', () => ({
  default: ({ loc }: { loc: string }) => <div data-testid="plan-component" data-loc={loc} />,
}))

describe('Billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentBillingUrl = 'https://billing'
    fetching = false
    isManager = true
    enableBilling = true
    refetchMock.mockResolvedValue({ data: 'https://billing' })
  })

  it('hides the billing action when user is not manager or billing is disabled', () => {
    isManager = false
    render(<Billing />)
    expect(screen.queryByRole('button', { name: /billing\.viewBillingTitle/ })).not.toBeInTheDocument()

    vi.clearAllMocks()
    isManager = true
    enableBilling = false
    render(<Billing />)
    expect(screen.queryByRole('button', { name: /billing\.viewBillingTitle/ })).not.toBeInTheDocument()
  })

  it('opens the billing window with the immediate url when the button is clicked', async () => {
    render(<Billing />)

    const actionButton = screen.getByRole('button', { name: /billing\.viewBillingTitle/ })
    fireEvent.click(actionButton)

    await waitFor(() => expect(openAsyncWindowMock).toHaveBeenCalled())
    const [, options] = openAsyncWindowMock.mock.calls[0]
    expect(options).toMatchObject({
      immediateUrl: currentBillingUrl,
      features: 'noopener,noreferrer',
    })
  })

  it('disables the button while billing url is fetching', () => {
    fetching = true
    render(<Billing />)

    const actionButton = screen.getByRole('button', { name: /billing\.viewBillingTitle/ })
    expect(actionButton).toBeDisabled()
  })
})
