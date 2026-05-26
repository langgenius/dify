import { useQuery } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DevicePage from '../page'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockDeviceLookup = vi.fn()

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
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

vi.mock('@/service/system-features', () => ({
  systemFeaturesQueryOptions: () => ({ queryKey: ['sys'], queryFn: async () => ({}) }),
}))

vi.mock('@/service/use-common', () => ({
  userProfileQueryOptions: () => ({ queryKey: ['profile'], queryFn: async () => null }),
  commonQueryKeys: { currentWorkspace: ['currentWorkspace'] },
}))

const mockUseQuery = vi.mocked(useQuery)

const VALID_CODE = 'ABCD-3456'

// Typed reference to the mocked DeviceFlowError — same module reference as classifyLookupError uses
type MockDeviceFlowErrorCtor = new (code: string, status: number) => Error
let MockDeviceFlowError: MockDeviceFlowErrorCtor

beforeEach(async () => {
  vi.clearAllMocks()
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
