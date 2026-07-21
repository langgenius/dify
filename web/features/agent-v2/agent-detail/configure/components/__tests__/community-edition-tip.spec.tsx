import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { defaultSystemFeatures } from '@/features/system-features/config'
import { LicenseStatus } from '@/features/system-features/constants'
import { CommunityEditionTip } from '../community-edition-tip'

// Literal rather than LicenseStatus.NONE: vi.hoisted runs before imports resolve.
const licenseStatus = vi.hoisted(() => ({
  current: 'none' as GetSystemFeaturesResponse['license']['status'],
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features', licenseStatus.current],
    queryFn: async () => ({
      ...defaultSystemFeatures,
      license: { ...defaultSystemFeatures.license, status: licenseStatus.current },
    }),
  }),
}))

const tip = 'sandbox runs as a non-root user'

const renderTip = async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div>loading</div>}>
        <CommunityEditionTip tip={tip} />
        {/* Sibling marker: the component renders null when licensed, so there is
            nothing of its own to wait on once the suspense boundary resolves. */}
        <div>resolved</div>
      </Suspense>
    </QueryClientProvider>,
  )

  await screen.findByText('resolved')
}

describe('CommunityEditionTip', () => {
  it('shows the warning without an enterprise license', async () => {
    licenseStatus.current = LicenseStatus.NONE

    await renderTip()

    expect(screen.getByLabelText(tip)).toBeInTheDocument()
  })

  it('renders nothing under an active enterprise license', async () => {
    licenseStatus.current = LicenseStatus.ACTIVE

    await renderTip()

    expect(screen.queryByLabelText(tip)).not.toBeInTheDocument()
  })

  it('renders nothing while an enterprise license is expiring', async () => {
    licenseStatus.current = LicenseStatus.EXPIRING

    await renderTip()

    expect(screen.queryByLabelText(tip)).not.toBeInTheDocument()
  })

  it('keeps the warning when an enterprise license has lapsed', async () => {
    licenseStatus.current = LicenseStatus.EXPIRED

    await renderTip()

    expect(screen.getByLabelText(tip)).toBeInTheDocument()
  })

  it('keeps the warning when the license status is unrecognized', async () => {
    licenseStatus.current = 'some-future-status' as GetSystemFeaturesResponse['license']['status']

    await renderTip()

    expect(screen.getByLabelText(tip)).toBeInTheDocument()
  })
})
