import { zGetFeaturesResponse } from '@dify/contracts/api/console/features/zod.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/console'
import { render } from '@/test/console/render'
import { createSystemFeaturesFixture } from '@/test/console/system-features'
import { DocumentUploadPlanNotice } from '../plan-notice'

vi.mock('@/features/system-features/state', async () => {
  const { atom } = await import('jotai')
  return { deploymentEditionAtom: atom('CLOUD') }
})

vi.mock('@/service/console', () => ({
  consoleQuery: {
    features: {
      get: { queryOptions: (options: object) => ({ queryKey: ['features'], ...options }) },
    },
    systemFeatures: {
      get: { queryOptions: (options: object) => ({ queryKey: ['system-features'], ...options }) },
    },
  },
}))

function renderNotice(plan: 'sandbox' | 'professional' | 'team') {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  client.setQueryData(
    consoleQuery.features.get.queryOptions().queryKey,
    zGetFeaturesResponse.parse({ billing: { subscription: { plan } } }),
  )
  client.setQueryData(
    consoleQuery.systemFeatures.get.queryOptions().queryKey,
    createSystemFeaturesFixture({ deployment_edition: 'CLOUD' }),
  )
  const onUrlUpdate = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <DocumentUploadPlanNotice fileSizeLimitMb={15} />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  )
  return onUrlUpdate
}

it('shows the free upload constraints and opens the existing pricing flow for batch uploads', async () => {
  const user = userEvent.setup()
  const onUrlUpdate = renderNotice('sandbox')
  expect(screen.getByText('billing.upgrade.uploadMultiplePages.title')).toBeVisible()
  expect(
    screen.getByText(/datasetCreation\.stepOne\.uploader\.tip:.*"size":15.*"batchCount":1/),
  ).toBeVisible()
  expect(screen.queryByText('billing.upgrade.uploadMultipleFiles.title')).not.toBeInTheDocument()
  expect(
    screen.queryByText('billing.upgrade.uploadMultipleFiles.description'),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'billing.triggerLimitModal.upgrade' }))
  await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledOnce())
  expect(onUrlUpdate.mock.calls[0]?.[0].searchParams.get('pricing')).toBe('open')
})

it.each(['professional', 'team'] as const)(
  'does not show the free upload notice for %s',
  (plan) => {
    renderNotice(plan)
    expect(screen.queryByText('billing.upgrade.uploadMultiplePages.title')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'billing.triggerLimitModal.upgrade' }),
    ).not.toBeInTheDocument()
  },
)
