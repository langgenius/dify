import { waitFor } from '@testing-library/react'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { PartnerStackCookieRecorder } from '../cookie-recorder'

const mocks = vi.hoisted(() => ({
  saveOrUpdate: vi.fn(),
}))

vi.mock('../use-ps-info', () => ({
  default: () => ({ saveOrUpdate: mocks.saveOrUpdate }),
}))

describe('PartnerStackCookieRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('records PartnerStack cookies in Cloud deployments', async () => {
    renderWithConsoleQuery(<PartnerStackCookieRecorder />, {
      systemFeatures: { deployment_edition: 'CLOUD' },
    })

    await waitFor(() => expect(mocks.saveOrUpdate).toHaveBeenCalledTimes(1))
  })

  it('does not record PartnerStack cookies outside Cloud deployments', () => {
    renderWithConsoleQuery(<PartnerStackCookieRecorder />, {
      systemFeatures: { deployment_edition: 'COMMUNITY' },
    })

    expect(mocks.saveOrUpdate).not.toHaveBeenCalled()
  })
})
