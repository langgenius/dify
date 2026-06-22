import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Billing from '../index'

let currentBillingUrl: string | null = 'https://billing'
let fetching = false
let isManager = true
let enableBilling = true
let workspacePermissionKeys: string[] = ['billing.subscription.manage']

const refetchMock = vi.fn()
const openAsyncWindowMock = vi.fn()

type BillingUrlCallback = () => Promise<string | null>
type BillingWindowOptions = {
  immediateUrl: string | null
  features: string
  onError: (err: Error) => void
}
type OpenAsyncWindowCall = [BillingUrlCallback, BillingWindowOptions]

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
    workspacePermissionKeys,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableBilling,
  }),
}))

vi.mock('../../plan', () => ({
  default: ({ loc }: { loc: string }) => <div data-testid="plan-component" data-loc={loc} />,
}))

describe('Billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentBillingUrl = 'https://billing'
    fetching = false
    isManager = true
    enableBilling = true
    workspacePermissionKeys = ['billing.subscription.manage']
    refetchMock.mockResolvedValue({ data: 'https://billing' })
  })

  it('shows the billing action when subscription management permission is granted without manager role', () => {
    isManager = false

    render(<Billing />)

    expect(screen.getByRole('button', { name: /billing\.viewBillingTitle/ })).toBeInTheDocument()
  })

  it('hides the billing action when subscription management permission is missing or billing is disabled', () => {
    workspacePermissionKeys = []
    render(<Billing />)
    expect(screen.queryByRole('button', { name: /billing\.viewBillingTitle/ })).not.toBeInTheDocument()

    vi.clearAllMocks()
    workspacePermissionKeys = ['billing.subscription.manage']
    enableBilling = false
    render(<Billing />)
    expect(screen.queryByRole('button', { name: /billing\.viewBillingTitle/ })).not.toBeInTheDocument()
  })

  it('opens the billing window with the immediate url when the button is clicked', async () => {
    render(<Billing />)

    const actionButton = screen.getByRole('button', { name: /billing\.viewBillingTitle/ })
    fireEvent.click(actionButton)

    await waitFor(() => expect(openAsyncWindowMock).toHaveBeenCalled())
    const [, options] = openAsyncWindowMock.mock.calls[0] as OpenAsyncWindowCall
    expect(options).toMatchObject({
      immediateUrl: currentBillingUrl,
      features: 'noopener,noreferrer',
    })
  })

  it('returns the refetched url from the async callback', async () => {
    const newUrl = 'https://new-billing-url'
    refetchMock.mockResolvedValue({ data: newUrl })
    render(<Billing />)

    const actionButton = screen.getByRole('button', { name: /billing\.viewBillingTitle/ })
    fireEvent.click(actionButton)

    await waitFor(() => expect(openAsyncWindowMock).toHaveBeenCalled())
    const [asyncCallback] = openAsyncWindowMock.mock.calls[0] as OpenAsyncWindowCall

    // Execute the async callback passed to openAsyncWindow
    const result = await asyncCallback()
    expect(result).toBe(newUrl)
    expect(refetchMock).toHaveBeenCalled()
  })

  it('returns null when refetch returns no url', async () => {
    refetchMock.mockResolvedValue({ data: null })
    render(<Billing />)

    const actionButton = screen.getByRole('button', { name: /billing\.viewBillingTitle/ })
    fireEvent.click(actionButton)

    await waitFor(() => expect(openAsyncWindowMock).toHaveBeenCalled())
    const [asyncCallback] = openAsyncWindowMock.mock.calls[0] as OpenAsyncWindowCall

    // Execute the async callback when url is null
    const result = await asyncCallback()
    expect(result).toBeNull()
  })

  it('handles errors in onError callback', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Billing />)

    const actionButton = screen.getByRole('button', { name: /billing\.viewBillingTitle/ })
    fireEvent.click(actionButton)

    await waitFor(() => expect(openAsyncWindowMock).toHaveBeenCalled())
    const [, options] = openAsyncWindowMock.mock.calls[0] as OpenAsyncWindowCall

    // Execute the onError callback
    const testError = new Error('Test error')
    options.onError(testError)
    expect(consoleError).toHaveBeenCalledWith('Failed to fetch billing url', testError)

    consoleError.mockRestore()
  })

  it('disables the button while billing url is fetching', () => {
    fetching = true
    render(<Billing />)

    const actionButton = screen.getByRole('button', { name: /billing\.viewBillingTitle/ })
    expect(actionButton)!.toBeDisabled()
  })
})
