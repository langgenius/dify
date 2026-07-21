import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { defaultSystemFeatures } from '@/features/system-features/config'
import { LicenseStatus } from '@/features/system-features/constants'
import { CommunityEditionTip } from '../community-edition-tip'

const systemFeatures = vi.hoisted(() => ({
  enterpriseEnabled: false,
  // Literal rather than LicenseStatus.NONE: vi.hoisted runs before imports resolve.
  licenseStatus: 'none' as string,
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features', systemFeatures.enterpriseEnabled, systemFeatures.licenseStatus],
    queryFn: async () => ({
      ...defaultSystemFeatures,
      enterprise_enabled: systemFeatures.enterpriseEnabled,
      license: { ...defaultSystemFeatures.license, status: systemFeatures.licenseStatus },
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
        {/* Sibling marker: the component renders null on enterprise, so there is
            nothing of its own to wait on once the suspense boundary resolves. */}
        <div>resolved</div>
      </Suspense>
    </QueryClientProvider>,
  )

  await screen.findByText('resolved')
}

describe('CommunityEditionTip', () => {
  it('shows the warning on a community edition deployment', async () => {
    systemFeatures.enterpriseEnabled = false
    systemFeatures.licenseStatus = LicenseStatus.NONE

    await renderTip()

    expect(screen.getByLabelText(tip)).toBeInTheDocument()
  })

  it('renders nothing on an enterprise deployment', async () => {
    systemFeatures.enterpriseEnabled = true
    systemFeatures.licenseStatus = LicenseStatus.ACTIVE

    await renderTip()

    expect(screen.queryByLabelText(tip)).not.toBeInTheDocument()
  })

  it('stays hidden on an enterprise deployment whose license has lapsed', async () => {
    // Sandbox isolation is a property of the build, not of billing state.
    systemFeatures.enterpriseEnabled = true
    systemFeatures.licenseStatus = LicenseStatus.EXPIRED

    await renderTip()

    expect(screen.queryByLabelText(tip)).not.toBeInTheDocument()
  })

  it('shows the warning on community edition even with an active license', async () => {
    // Guards against regressing the gate back to license status.
    systemFeatures.enterpriseEnabled = false
    systemFeatures.licenseStatus = LicenseStatus.ACTIVE

    await renderTip()

    expect(screen.getByLabelText(tip)).toBeInTheDocument()
  })
})
