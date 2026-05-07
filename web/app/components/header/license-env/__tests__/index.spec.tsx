import { screen } from '@testing-library/react'
import dayjs from 'dayjs'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { LicenseStatus } from '@/types/feature'
import LicenseNav from '../index'

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

  it('should render null when license status is NONE', () => {
    const { container } = renderWithSystemFeatures(<LicenseNav />)
    expect(container).toBeEmptyDOMElement()
  })

  it('should render Enterprise badge when license status is ACTIVE', () => {
    renderWithSystemFeatures(<LicenseNav />, {
      systemFeatures: {
        license: {
          status: LicenseStatus.ACTIVE,
          expired_at: null,
        },
      },
    })
    expect(screen.getByText('Enterprise')).toBeInTheDocument()
  })

  it('should render singular expiring message when license expires in 0 days', () => {
    const expiredAt = dayjs().add(2, 'hours').toISOString()
    renderWithSystemFeatures(<LicenseNav />, {
      systemFeatures: {
        license: {
          status: LicenseStatus.EXPIRING,
          expired_at: expiredAt,
        },
      },
    })
    expect(screen.getByText(/license\.expiring/)).toBeInTheDocument()
    expect(screen.getByText(/count":0/)).toBeInTheDocument()
  })

  it('should render singular expiring message when license expires in 1 day', () => {
    const tomorrow = dayjs().add(1, 'day').add(1, 'hour').toISOString()
    renderWithSystemFeatures(<LicenseNav />, {
      systemFeatures: {
        license: {
          status: LicenseStatus.EXPIRING,
          expired_at: tomorrow,
        },
      },
    })
    expect(screen.getByText(/license\.expiring/)).toBeInTheDocument()
    expect(screen.getByText(/count":1/)).toBeInTheDocument()
  })

  it('should render plural expiring message when license expires in 5 days', () => {
    const fiveDaysLater = dayjs().add(5, 'day').add(1, 'hour').toISOString()
    renderWithSystemFeatures(<LicenseNav />, {
      systemFeatures: {
        license: {
          status: LicenseStatus.EXPIRING,
          expired_at: fiveDaysLater,
        },
      },
    })
    expect(screen.getByText(/license\.expiring_plural/)).toBeInTheDocument()
    expect(screen.getByText(/count":5/)).toBeInTheDocument()
  })
})
