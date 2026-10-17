import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { DeviceFlowError } from '@/service/device-flow'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
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

vi.mock('@/service/device-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/device-flow')>()),
  deviceLookup: (...args: unknown[]) => mockDeviceLookup(...args),
}))

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({ queryKey: ['profile'], queryFn: async () => null }),
}))

const VALID_CODE = 'ABCD-3456'

beforeEach(() => {
  vi.clearAllMocks()
  document.title = ''
  mockSearchParams = {}
  // router.replace(pathname) in the real app drops the query string; mirror
  // that so useSearchParams reflects the cleared URL on the next render.
  mockReplace.mockImplementation(() => {
    mockSearchParams = {}
  })
})

async function reachTerminal(rejectWith: unknown) {
  mockDeviceLookup.mockRejectedValue(rejectWith)
  render(<DevicePage />)
  const user = userEvent.setup()
  await user.type(screen.getByRole('textbox'), VALID_CODE)
  await user.click(screen.getByRole('button', { name: /deviceFlow.codeEntry.continue/i }))
}

it.each([
  {
    error: new Error('expired'),
    title: 'deviceFlow.errorExpired.title',
    retry: 'deviceFlow.errorExpired.tryDifferentCode',
  },
  {
    error: new DeviceFlowError('rate_limited', 429),
    title: 'deviceFlow.errorRateLimited.title',
    retry: 'deviceFlow.tryAgain',
  },
  {
    error: new DeviceFlowError('server_error', 500),
    title: 'deviceFlow.errorLookupFailed.title',
    retry: 'deviceFlow.tryAgain',
  },
])('shows $title and lets the user enter another code', async ({ error, title, retry }) => {
  const user = userEvent.setup()
  await reachTerminal(error)
  expect(await screen.findByRole('heading', { name: title })).toBeVisible()
  await waitFor(() => expect(document.title).toBe(`${title} - Dify`))
  await user.click(screen.getByRole('button', { name: retry }))
  expect(screen.getByRole('textbox')).toBeVisible()
  expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument()
})

describe('error_sso dedicated view', () => {
  const TITLE = 'deviceFlow.errorSso.title'
  const GENERIC = 'deviceFlow.ssoError.default'
  const EMAIL_COPY = 'deviceFlow.ssoError.emailBelongsToDifyAccount'
  const BACK_TO_LOGIN = 'deviceFlow.errorSso.backToLoginOptions'

  it('renders the dedicated SSO error screen (not the code-entry page)', async () => {
    mockSearchParams = { sso_error: 'sso_failed', user_code: 'ABCD-3456' }
    render(<DevicePage />)
    expect(await screen.findByText(TITLE)).toBeInTheDocument()
    expect(await screen.findByText(GENERIC)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(mockReplace).toHaveBeenCalledWith('/device')
  })

  it('shows the email special-case copy', async () => {
    mockSearchParams = { sso_error: 'email_belongs_to_dify_account', user_code: 'ABCD-3456' }
    render(<DevicePage />)
    expect(await screen.findByText(EMAIL_COPY)).toBeInTheDocument()
    expect(screen.queryByText('email_belongs_to_dify_account')).not.toBeInTheDocument()
  })

  it('"Back to login options" re-checks the code and advances to the chooser', async () => {
    mockSearchParams = { sso_error: 'sso_failed', user_code: 'ABCD-3456' }
    mockDeviceLookup.mockResolvedValue({ valid: true })
    render(<DevicePage />)
    await screen.findByText(TITLE)
    await userEvent.setup().click(screen.getByRole('button', { name: BACK_TO_LOGIN }))
    await screen.findByText('deviceFlow.chooser.subtitle')
    expect(mockDeviceLookup).toHaveBeenCalledWith('ABCD-3456')
  })

  it('shows no SSO error screen when sso_error is absent', () => {
    render(<DevicePage />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument()
    expect(document.title).toBe('deviceFlow.codeEntry.title - Dify')
  })
})
