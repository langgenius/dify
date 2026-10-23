import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { DocumentUploadPlanNotice } from '../plan-notice'

function renderNotice(plan: 'sandbox' | 'professional' | 'team') {
  const onUrlUpdate = vi.fn()
  renderWithConsoleQuery(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
      <DocumentUploadPlanNotice fileSizeLimitMb={15} />
    </NuqsTestingAdapter>,
    {
      features: { billing: { subscription: { plan } } },
      systemFeatures: { deployment_edition: 'CLOUD' },
    },
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
