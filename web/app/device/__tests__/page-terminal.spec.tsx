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
  fireEvent.click(screen.getByRole('button', { name: /Continue/i }))
}

describe('error_expired terminal state', () => {
  it('shows "Code no longer valid" heading', async () => {
    await reachTerminal(new Error('expired'))
    await screen.findByText('Code no longer valid')
  })

  it('ghost button resets to code_entry', async () => {
    await reachTerminal(new Error('expired'))
    await screen.findByText('Code no longer valid')
    fireEvent.click(screen.getByRole('button', { name: /Try a different code/i }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText('Code no longer valid')).not.toBeInTheDocument()
  })
})

describe('error_rate_limited terminal state', () => {
  it('shows "Too many attempts" heading', async () => {
    await reachTerminal(new MockDeviceFlowError('rate_limited', 429))
    await screen.findByText('Too many attempts')
  })

  it('ghost button resets to code_entry', async () => {
    await reachTerminal(new MockDeviceFlowError('rate_limited', 429))
    await screen.findByText('Too many attempts')
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText('Too many attempts')).not.toBeInTheDocument()
  })
})

describe('error_lookup_failed terminal state', () => {
  it('shows "Could not verify the code" heading', async () => {
    await reachTerminal(new MockDeviceFlowError('server_error', 500))
    await screen.findByText('Could not verify the code')
  })

  it('ghost button resets to code_entry', async () => {
    await reachTerminal(new MockDeviceFlowError('server_error', 500))
    await screen.findByText('Could not verify the code')
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText('Could not verify the code')).not.toBeInTheDocument()
  })
})

describe('error_sso dedicated view', () => {
  const GENERIC = /single sign-on could not be completed/i

  it('renders the dedicated SSO error screen (not the code-entry page)', async () => {
    mockSearchParams = { sso_error: 'sso_failed', user_code: 'ABCD-3456' }
    render(<DevicePage />)
    expect(await screen.findByText('Sign-in could not be completed')).toBeInTheDocument()
    expect(await screen.findByText(GENERIC)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows the email special-case copy', async () => {
    mockSearchParams = { sso_error: 'email_belongs_to_dify_account', user_code: 'ABCD-3456' }
    render(<DevicePage />)
    expect(await screen.findByText(/identity is linked to a Dify account/i)).toBeInTheDocument()
  })

  it('never surfaces the raw backend code', async () => {
    mockSearchParams = { sso_error: 'email_belongs_to_dify_account', user_code: 'ABCD-3456' }
    render(<DevicePage />)
    await screen.findByText(/identity is linked to a Dify account/i)
    expect(screen.queryByText('email_belongs_to_dify_account')).not.toBeInTheDocument()
  })

  it('scrubs sso_error + user_code from the URL on mount', async () => {
    mockSearchParams = { sso_error: 'sso_failed', user_code: 'ABCD-3456' }
    render(<DevicePage />)
    await screen.findByText('Sign-in could not be completed')
    expect(mockReplace).toHaveBeenCalledWith('/device')
  })

  it('"Back to login options" re-checks the code and advances to the chooser', async () => {
    mockSearchParams = { sso_error: 'sso_failed', user_code: 'ABCD-3456' }
    mockDeviceLookup.mockResolvedValue({ valid: true })
    render(<DevicePage />)
    await screen.findByText('Sign-in could not be completed')
    fireEvent.click(screen.getByRole('button', { name: /Back to login options/i }))
    await screen.findByText(/is valid/i)
    expect(mockDeviceLookup).toHaveBeenCalledWith('ABCD-3456')
  })

  it('shows no SSO error screen when sso_error is absent', () => {
    render(<DevicePage />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText('Sign-in could not be completed')).not.toBeInTheDocument()
  })
})
