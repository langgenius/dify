import { QueryClientProvider } from '@tanstack/react-query'
import {
  fireEvent,
  render as renderWithoutQueryClient,
  screen,
  waitFor,
} from '@testing-library/react'
import { createTestQueryClient } from '@/__tests__/utils/mock-system-features'
import { consoleQuery } from '@/service/client'
import Billing from '../index'

let currentBillingUrl = 'https://billing'
let fetching = false
let isManager = true
let enableBilling = true
let workspacePermissionKeys: string[] = ['billing.subscription.manage']

const fetchBillingUrlMock = vi.fn()
const openAsyncWindowMock = vi.fn()
const mockRequest = vi.hoisted(() => vi.fn())

type BillingUrlCallback = () => Promise<string | null>
type BillingWindowOptions = {
  immediateUrl: string | null
  features: string
  onError: (err: Error) => void
}
type OpenAsyncWindowCall = [BillingUrlCallback, BillingWindowOptions]

vi.mock('@/hooks/use-async-window-open', () => ({
  useAsyncWindowOpen: () => openAsyncWindowMock,
}))

vi.mock('@/service/base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/base')>()
  return { ...actual, request: mockRequest }
})

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    isCurrentWorkspaceManager: isManager,
    workspacePermissionKeys,
  }))
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    isCurrentWorkspaceManager: isManager,
    workspacePermissionKeys,
  }))
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    isCurrentWorkspaceManager: isManager,
    workspacePermissionKeys,
  }))
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    isCurrentWorkspaceManager: isManager,
    workspacePermissionKeys,
  }))
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createAppContextStateAtomMock } = await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateAtomMock(importOriginal, () => ({
    isCurrentWorkspaceManager: isManager,
    workspacePermissionKeys,
  }))
})

vi.mock('jotai', async (importOriginal) => {
  const { createAppContextStateJotaiMock } =
    await import('@/__tests__/utils/mock-app-context-state')
  return createAppContextStateJotaiMock(importOriginal)
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableBilling,
  }),
}))

vi.mock('../../plan', () => ({
  default: ({ loc }: { loc: string }) => <div data-testid="plan-component" data-loc={loc} />,
}))

const render = (ui: React.ReactElement) => {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(consoleQuery.billing.invoices.get.queryKey(), {
    url: currentBillingUrl,
  })
  if (fetching) {
    void queryClient.fetchQuery({
      queryKey: consoleQuery.billing.invoices.get.queryKey(),
      queryFn: () => new Promise(() => {}),
      staleTime: 0,
    })
  }
  return renderWithoutQueryClient(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

describe('Billing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentBillingUrl = 'https://billing'
    fetching = false
    isManager = true
    enableBilling = true
    workspacePermissionKeys = ['billing.subscription.manage']
    fetchBillingUrlMock.mockResolvedValue({ url: 'https://billing' })
    mockRequest.mockImplementation(async () => {
      const data = await fetchBillingUrlMock()
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      })
    })
  })

  it('hides the billing action when subscription management permission is granted without manager role', () => {
    isManager = false

    render(<Billing />)

    expect(
      screen.queryByRole('button', { name: /billing\.viewBillingTitle/ }),
    ).not.toBeInTheDocument()
  })

  it('hides the billing action when subscription management permission is missing or billing is disabled', () => {
    workspacePermissionKeys = []
    render(<Billing />)
    expect(
      screen.queryByRole('button', { name: /billing\.viewBillingTitle/ }),
    ).not.toBeInTheDocument()

    vi.clearAllMocks()
    workspacePermissionKeys = ['billing.subscription.manage']
    enableBilling = false
    render(<Billing />)
    expect(
      screen.queryByRole('button', { name: /billing\.viewBillingTitle/ }),
    ).not.toBeInTheDocument()
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
    fetchBillingUrlMock.mockResolvedValue({ url: newUrl })
    render(<Billing />)

    const actionButton = screen.getByRole('button', { name: /billing\.viewBillingTitle/ })
    fireEvent.click(actionButton)

    await waitFor(() => expect(openAsyncWindowMock).toHaveBeenCalled())
    const [asyncCallback] = openAsyncWindowMock.mock.calls[0] as OpenAsyncWindowCall

    // Execute the async callback passed to openAsyncWindow
    const result = await asyncCallback()
    expect(result).toBe(newUrl)
    expect(fetchBillingUrlMock).toHaveBeenCalled()
  })

  it('returns null when refetch returns no url', async () => {
    fetchBillingUrlMock.mockResolvedValue({ url: '' })
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
