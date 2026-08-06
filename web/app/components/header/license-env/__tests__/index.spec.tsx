import { screen } from '@testing-library/react'
import dayjs from 'dayjs'
import { LicenseStatus } from '@/features/system-features/constants'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery,
  seedSystemFeaturesLicense,
} from '@/test/console/query-data'
import LicenseNav from '../index'

const renderLicenseNav = (license?: Parameters<typeof seedSystemFeaturesLicense>[1]) => {
  const queryClient = createConsoleQueryClient()
  if (license) seedSystemFeaturesLicense(queryClient, license)
  else {
    void queryClient.prefetchQuery({
      queryKey: consoleQuery.systemFeatures.license.get.queryOptions().queryKey,
      queryFn: () => new Promise(() => {}),
    })
  }
  return renderWithConsoleQuery(<LicenseNav />, { queryClient })
}

describe('LicenseNav', () => {
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
    const { container } = renderLicenseNav()
    expect(container).toBeEmptyDOMElement()
  })

  it('should render nothing when license status is NONE', () => {
    const { container } = renderLicenseNav({})
    expect(container).toBeEmptyDOMElement()
  })

  it('should render Enterprise badge when license status is ACTIVE', () => {
    renderLicenseNav({ status: LicenseStatus.ACTIVE })
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
  })

  it('should render singular expiring message when license expires in 0 days', () => {
    const expiredAt = dayjs().add(2, 'hours').toISOString()
    renderLicenseNav({ status: LicenseStatus.EXPIRING, expired_at: expiredAt })
    expect(screen.getByText(/license\.expiring/)).toBeInTheDocument()
    expect(screen.getByText(/count":0/)).toBeInTheDocument()
  })

  it('should render singular expiring message when license expires in 1 day', () => {
    const tomorrow = dayjs().add(1, 'day').add(1, 'hour').toISOString()
    renderLicenseNav({ status: LicenseStatus.EXPIRING, expired_at: tomorrow })
    expect(screen.getByText(/license\.expiring/)).toBeInTheDocument()
    expect(screen.getByText(/count":1/)).toBeInTheDocument()
  })

  it('should render plural expiring message when license expires in 5 days', () => {
    const fiveDaysLater = dayjs().add(5, 'day').add(1, 'hour').toISOString()
    renderLicenseNav({ status: LicenseStatus.EXPIRING, expired_at: fiveDaysLater })
    expect(screen.getByText(/license\.expiring_plural/)).toBeInTheDocument()
    expect(screen.getByText(/count":5/)).toBeInTheDocument()
  })
})
