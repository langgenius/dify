import { useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DevicePage from '../page'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockDeviceLookup = vi.fn()
let mockSearchParams: Record<string, string | null> = {}

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => mockSearchParams[key] ?? null }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/device',
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useQuery: vi.fn(),
  }
})

vi.mock('@/service/device-flow', () => ({
  deviceLookup: (...args: unknown[]) => mockDeviceLookup(...args),
  DeviceFlowError: class extends Error {
    code: string
    status: number
    constructor(code: string, status = 400) {
      super(code)
      this.code = code
      this.status = status
    }
  },
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({ queryKey: ['sys'], queryFn: async () => ({}) }),
}))

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({ queryKey: ['profile'], queryFn: async () => null }),
}))

vi.mock('@/service/use-common', () => ({
  commonQueryKeys: { currentWorkspace: ['currentWorkspace'] },
}))

const mockUseQuery = vi.mocked(useQuery)

const VALID_CODE = 'ABCD-3456'

// Typed reference to the mocked DeviceFlowError — same module reference as classifyLookupError uses
type MockDeviceFlowErrorCtor = new (code: string, status: number) => Error
let MockDeviceFlowError: MockDeviceFlowErrorCtor

beforeEach(async () => {
  vi.clearAllMocks()
  mockSearchParams = {}
  // router.replace(pathname) in the real app drops the query string; mirror
  // that so useSearchParams reflects the cleared URL on the next render.
  mockReplace.mockImplementation(() => {
    mockSearchParams = {}
  })
  mockUseQuery.mockReturnValue({ data: undefined, isError: false } as ReturnType<typeof useQuery>)
  const mod = await import('@/service/device-flow') as { DeviceFlowError: MockDeviceFlowErrorCtor }
  MockDeviceFlowError = mod.DeviceFlowError
})

async function reachTerminal(rejectWith: unknown) {
  mockDeviceLookup.mockRejectedValue(rejectWith)
  render(<DevicePage />)
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: VALID_CODE } })
  fireEvent.click(screen.getByRole('button', { name: /deviceFlow.codeEntry.continue/i }))
}

describe('error_expired terminal state', () => {
  it('shows "errorExpired.title" heading', async () => {
    await reachTerminal(new Error('expired'))
    await screen.findByText('deviceFlow.errorExpired.title')
  })

  it('ghost button resets to code_entry', async () => {
    await reachTerminal(new Error('expired'))
    await screen.findByText('deviceFlow.errorExpired.title')
    fireEvent.click(screen.getByRole('button', { name: /deviceFlow.errorExpired.tryDifferentCode/i }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText('deviceFlow.errorExpired.title')).not.toBeInTheDocument()
  })
})

describe('error_rate_limited terminal state', () => {
  it('shows "errorRateLimited.title" heading', async () => {
    await reachTerminal(new MockDeviceFlowError('rate_limited', 429))
    await screen.findByText('deviceFlow.errorRateLimited.title')
  })

  it('ghost button resets to code_entry', async () => {
    await reachTerminal(new MockDeviceFlowError('rate_limited', 429))
    await screen.findByText('deviceFlow.errorRateLimited.title')
    fireEvent.click(screen.getByRole('button', { name: /deviceFlow.tryAgain/i }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText('deviceFlow.errorRateLimited.title')).not.toBeInTheDocument()
  })
})

describe('error_lookup_failed terminal state', () => {
  it('shows "errorLookupFailed.title" heading', async () => {
    await reachTerminal(new MockDeviceFlowError('server_error', 500))
    await screen.findByText('deviceFlow.errorLookupFailed.title')
  })

  it('ghost button resets to code_entry', async () => {
    await reachTerminal(new MockDeviceFlowError('server_error', 500))
    await screen.findByText('deviceFlow.errorLookupFailed.title')
    fireEvent.click(screen.getByRole('button', { name: /deviceFlow.tryAgain/i }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText('deviceFlow.errorLookupFailed.title')).not.toBeInTheDocument()
  })
})

describe('sso_error inline banner on the code-entry page', () => {
  const SSO_BANNER_COPY = 'deviceFlow.ssoError.emailBelongsToDifyAccount'

  it('shows the error banner with friendly copy when sso_error is present', async () => {
    mockSearchParams = { sso_error: 'email_belongs_to_dify_account' }
    render(<DevicePage />)
    expect(await screen.findByText(SSO_BANNER_COPY)).toBeInTheDocument()
  })

  it('keeps the code-entry screen visible (error on main page, not a separate view)', async () => {
    mockSearchParams = { sso_error: 'email_belongs_to_dify_account' }
    render(<DevicePage />)
    await screen.findByText(SSO_BANNER_COPY)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deviceFlow.codeEntry.continue/i })).toBeInTheDocument()
  })

  it('does not surface the raw backend error code', async () => {
    mockSearchParams = { sso_error: 'email_belongs_to_dify_account' }
    render(<DevicePage />)
    await screen.findByText(SSO_BANNER_COPY)
    expect(screen.queryByText('email_belongs_to_dify_account')).not.toBeInTheDocument()
  })

  it('does not scrub the param on mount (regression: error was wiped by router.replace)', async () => {
    mockSearchParams = { sso_error: 'email_belongs_to_dify_account' }
    render(<DevicePage />)
    await screen.findByText(SSO_BANNER_COPY)
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('shows no banner when sso_error is absent', () => {
    render(<DevicePage />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText(SSO_BANNER_COPY)).not.toBeInTheDocument()
  })
})
