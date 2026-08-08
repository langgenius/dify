import { zLicenseStatus } from '@dify/contracts/api/console/system-features/zod.gen'
import { screen } from '@testing-library/react'
import dayjs from 'dayjs'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedSystemFeaturesLicense,
} from '@/test/console/query-data'
import LicenseBadge from '../index'

const renderLicenseBadge = (license?: Parameters<typeof seedSystemFeaturesLicense>[1]) => {
  const queryClient = createConsoleQueryClient()
  if (license) seedSystemFeaturesLicense(queryClient, license)
  else {
    void queryClient.prefetchQuery({
      queryKey: consoleQuery.systemFeatures.license.get.queryOptions().queryKey,
      queryFn: () => new Promise(() => {}),
    })
  }
  return renderWithConsoleQuery(<LicenseBadge />, { queryClient })
}

describe('LicenseBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    const now = new Date('2024-01-01T12:00:00Z')
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should render nothing while license detail is loading', () => {
    const { container } = renderLicenseBadge()
    expect(container).toBeEmptyDOMElement()
  })

  it('should render nothing when license status is NONE', () => {
    const { container } = renderLicenseBadge({})
    expect(container).toBeEmptyDOMElement()
  })

  it('should render Enterprise badge when license status is ACTIVE', () => {
    renderLicenseBadge({ status: zLicenseStatus.enum.active })
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
  })

  it('should render singular expiring message when license expires in 0 days', () => {
    const expiredAt = dayjs().add(2, 'hours').toISOString()
    renderLicenseBadge({
      status: zLicenseStatus.enum.expiring,
      expired_at: expiredAt,
      license_expiry_notice_enabled: true,
    })
    expect(screen.getByText(/license\.expiring/)).toBeInTheDocument()
    expect(screen.getByText(/count":0/)).toBeInTheDocument()
  })

  it('should render singular expiring message when license expires in 1 day', () => {
    const tomorrow = dayjs().add(1, 'day').add(1, 'hour').toISOString()
    renderLicenseBadge({
      status: zLicenseStatus.enum.expiring,
      expired_at: tomorrow,
      license_expiry_notice_enabled: true,
    })
    expect(screen.getByText(/license\.expiring/)).toBeInTheDocument()
    expect(screen.getByText(/count":1/)).toBeInTheDocument()
  })

  it('should render plural expiring message when license expires in 5 days', () => {
    const fiveDaysLater = dayjs().add(5, 'day').add(1, 'hour').toISOString()
    renderLicenseBadge({
      status: zLicenseStatus.enum.expiring,
      expired_at: fiveDaysLater,
      license_expiry_notice_enabled: true,
    })
    expect(screen.getByText(/license\.expiring_plural/)).toBeInTheDocument()
    expect(screen.getByText(/count":5/)).toBeInTheDocument()
  })

  it('should fall back to the Enterprise badge when the expiry notice is disabled', () => {
    const fiveDaysLater = dayjs().add(5, 'day').add(1, 'hour').toISOString()
    renderLicenseBadge({
      status: zLicenseStatus.enum.expiring,
      expired_at: fiveDaysLater,
      license_expiry_notice_enabled: false,
    })
    expect(screen.queryByText(/license\.expiring/)).not.toBeInTheDocument()
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
  })

  it('should keep rendering the Enterprise badge for an active license when the expiry notice is disabled', () => {
    renderLicenseBadge({
      status: zLicenseStatus.enum.active,
      license_expiry_notice_enabled: false,
    })
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
  })
})
