import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { defaultSystemFeatures } from '@/features/system-features/config'
import { LicenseStatus } from '@/features/system-features/constants'
import { AgentOrchestrateHeader } from '../header'

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

const isolationTipLabel = 'agentV2.agentDetail.configure.communityEditionIsolationTip'

const renderHeader = async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<div>loading</div>}>
        <AgentOrchestrateHeader headingId="heading-1" />
      </Suspense>
    </QueryClientProvider>,
  )

  await screen.findByRole('heading')
}

describe('AgentOrchestrateHeader', () => {
  it('shows the sandbox isolation disclaimer without an enterprise license', async () => {
    licenseStatus.current = LicenseStatus.NONE

    await renderHeader()

    expect(screen.getByLabelText(isolationTipLabel)).toBeInTheDocument()
  })

  it('hides the disclaimer under an active enterprise license', async () => {
    licenseStatus.current = LicenseStatus.ACTIVE

    await renderHeader()

    expect(screen.queryByLabelText(isolationTipLabel)).not.toBeInTheDocument()
  })

  it('hides the disclaimer while an enterprise license is expiring', async () => {
    licenseStatus.current = LicenseStatus.EXPIRING

    await renderHeader()

    expect(screen.queryByLabelText(isolationTipLabel)).not.toBeInTheDocument()
  })

  it('keeps the disclaimer when an enterprise license has lapsed', async () => {
    licenseStatus.current = LicenseStatus.EXPIRED

    await renderHeader()

    expect(screen.getByLabelText(isolationTipLabel)).toBeInTheDocument()
  })
})
