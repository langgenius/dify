import type { GetWorkspacesCurrentSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { UserProfileWithMeta } from '@/features/account-profile/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { consoleQuery } from '@/service/client'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { createTestQueryClient } from '@/test/query-client'
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
  const mod = (await import('@/service/device-flow')) as {
    DeviceFlowError: MockDeviceFlowErrorCtor
  }
  MockDeviceFlowError = mod.DeviceFlowError
})

const renderDevicePage = ({
  summary,
  authenticated = true,
}: {
  summary?: GetWorkspacesCurrentSummaryResponse
  authenticated?: boolean
} = {}) => {
  const queryClient = createTestQueryClient()
  if (authenticated) {
    seedAccountProfileQuery(queryClient)
  } else {
    void queryClient.prefetchQuery({
      ...userProfileQueryOptions(),
      queryFn: () => new Promise<UserProfileWithMeta>(() => {}),
    })
  }
  queryClient.setQueryData(
    consoleQuery.systemFeatures.get.queryKey(),
    createSystemFeaturesFixture(),
  )

  if (summary) {
    queryClient.setQueryData(consoleQuery.workspaces.current.summary.get.queryKey(), summary)
  } else {
    void queryClient.prefetchQuery({
      queryKey: consoleQuery.workspaces.current.summary.get.queryKey(),
      queryFn: () => new Promise(() => {}),
    })
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <DevicePage />
    </QueryClientProvider>,
  )
}

async function reachTerminal(rejectWith: unknown) {
  mockDeviceLookup.mockRejectedValue(rejectWith)
  renderDevicePage()
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value: VALID_CODE } })
  fireEvent.click(screen.getByRole('button', { name: /deviceFlow.codeEntry.continue/i }))
}

it('shows the summary workspace name on the account authorization screen', async () => {
  mockSearchParams = { user_code: VALID_CODE }
  renderDevicePage({
    summary: {
      id: 'workspace-id',
      name: 'Summary Workspace',
      role: 'owner',
      plan: 'sandbox',
      credits: 200,
    },
  })

  expect(await screen.findByText('Summary Workspace')).toBeInTheDocument()
})

describe('error_expired terminal state', () => {
  it('shows "errorExpired.title" heading', async () => {
    await reachTerminal(new Error('expired'))
    await screen.findByText('deviceFlow.errorExpired.title')
  })

  it('ghost button resets to code_entry', async () => {
    await reachTerminal(new Error('expired'))
    await screen.findByText('deviceFlow.errorExpired.title')
    fireEvent.click(
      screen.getByRole('button', { name: /deviceFlow.errorExpired.tryDifferentCode/i }),
    )
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

describe('error_sso dedicated view', () => {
  const TITLE = 'deviceFlow.errorSso.title'
  const GENERIC = 'deviceFlow.ssoError.default'
  const EMAIL_COPY = 'deviceFlow.ssoError.emailBelongsToDifyAccount'
  const BACK_TO_LOGIN = 'deviceFlow.errorSso.backToLoginOptions'

  it('renders the dedicated SSO error screen (not the code-entry page)', async () => {
    mockSearchParams = { sso_error: 'sso_failed', user_code: 'ABCD-3456' }
    renderDevicePage()
    expect(await screen.findByText(TITLE)).toBeInTheDocument()
    expect(await screen.findByText(GENERIC)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows the email special-case copy', async () => {
    mockSearchParams = { sso_error: 'email_belongs_to_dify_account', user_code: 'ABCD-3456' }
    renderDevicePage()
    expect(await screen.findByText(EMAIL_COPY)).toBeInTheDocument()
  })

  it('never surfaces the raw backend code', async () => {
    mockSearchParams = { sso_error: 'email_belongs_to_dify_account', user_code: 'ABCD-3456' }
    renderDevicePage()
    await screen.findByText(EMAIL_COPY)
    expect(screen.queryByText('email_belongs_to_dify_account')).not.toBeInTheDocument()
  })

  it('scrubs sso_error + user_code from the URL on mount', async () => {
    mockSearchParams = { sso_error: 'sso_failed', user_code: 'ABCD-3456' }
    renderDevicePage()
    await screen.findByText(TITLE)
    expect(mockReplace).toHaveBeenCalledWith('/device')
  })

  it('"Back to login options" re-checks the code and advances to the chooser', async () => {
    mockSearchParams = { sso_error: 'sso_failed', user_code: 'ABCD-3456' }
    mockDeviceLookup.mockResolvedValue({ valid: true })
    renderDevicePage({ authenticated: false })
    await screen.findByText(TITLE)
    fireEvent.click(screen.getByRole('button', { name: BACK_TO_LOGIN }))
    await screen.findByText('deviceFlow.chooser.subtitle')
    expect(mockDeviceLookup).toHaveBeenCalledWith('ABCD-3456')
  })

  it('shows no SSO error screen when sso_error is absent', () => {
    renderDevicePage()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
  })
})
