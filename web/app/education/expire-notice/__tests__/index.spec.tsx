import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { EducationExpireNotice } from '../index'
import { resolveEducationExpireNotice } from '../use-expire-notice'

const mockEducationStatus = vi.hoisted(() => ({
  allowRefresh: true,
  expireAt: Date.UTC(2099, 0, 1) / 1000,
}))
const mockPricingModal = vi.hoisted(() => ({ isOpen: false }))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableEducationPlan: true,
  }),
}))

vi.mock('@/hooks/use-query-params', () => ({
  usePricingModal: () => [mockPricingModal.isOpen, vi.fn()],
}))

vi.mock('@/next/dynamic', () => ({
  default:
    () =>
    ({ expired, onClose }: { expired: boolean; onClose: () => void }) => (
      <div role="dialog">
        <span>{expired ? 'Expired' : 'Expiring'}</span>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ),
}))

const renderNotice = (accountId = 'user-1') => {
  const { wrapper } = createConsoleQueryWrapper({
    accountProfile: { id: accountId, timezone: 'UTC' },
    educationStatus: {
      allow_refresh: mockEducationStatus.allowRefresh,
      expire_at: mockEducationStatus.expireAt,
    },
  })

  return render(<EducationExpireNotice />, { wrapper })
}

describe('EducationExpireNotice', () => {
  beforeEach(() => {
    localStorage.clear()
    mockEducationStatus.allowRefresh = true
    mockEducationStatus.expireAt = Date.UTC(2099, 0, 1) / 1000
    mockPricingModal.isOpen = false
  })

  it('persists dismissal for the same account, expiration date, and phase', async () => {
    const user = userEvent.setup()
    const firstRender = renderNotice()

    expect(await screen.findByRole('dialog')).toHaveTextContent('Expiring')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    firstRender.unmount()
    renderNotice()

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows a new notice when the expiration identity changes', async () => {
    const user = userEvent.setup()
    const firstRender = renderNotice()

    await user.click(await screen.findByRole('button', { name: 'Close' }))
    firstRender.unmount()
    mockEducationStatus.expireAt = Date.UTC(2020, 0, 1) / 1000
    renderNotice()

    expect(await screen.findByRole('dialog')).toHaveTextContent('Expired')
  })

  it('defers the notice while the URL-driven pricing modal is open', async () => {
    mockPricingModal.isOpen = true

    renderNotice()

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('resolveEducationExpireNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-29T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('treats expiring and expired reminders as distinct dismissal identities', () => {
    const expireAt = Date.parse('2026-07-30T00:00:00Z') / 1000
    const dismissedNotice = {
      accountId: 'user-1',
      expireAt,
      phase: 'expiring' as const,
    }

    expect(
      resolveEducationExpireNotice({
        accountId: 'user-1',
        allowRefresh: true,
        dismissedNotice,
        expireAt,
        isLoading: false,
        userTimezone: 'UTC',
      }),
    ).toBeNull()

    vi.setSystemTime(new Date('2026-07-30T12:00:00Z'))

    expect(
      resolveEducationExpireNotice({
        accountId: 'user-1',
        allowRefresh: true,
        dismissedNotice,
        expireAt,
        isLoading: false,
        userTimezone: 'UTC',
      }),
    ).toMatchObject({ expired: true, phase: 'expired' })
  })

  it('scopes a dismissed reminder to the account that dismissed it', () => {
    const expireAt = Date.parse('2026-08-01T00:00:00Z') / 1000

    expect(
      resolveEducationExpireNotice({
        accountId: 'user-2',
        allowRefresh: true,
        dismissedNotice: {
          accountId: 'user-1',
          expireAt,
          phase: 'expiring',
        },
        expireAt,
        isLoading: false,
        userTimezone: 'UTC',
      }),
    ).toMatchObject({ accountId: 'user-2', phase: 'expiring' })
  })
})
