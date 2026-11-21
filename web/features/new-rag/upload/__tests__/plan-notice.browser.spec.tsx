import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { DocumentUploadPlanNotice } from '../plan-notice'

async function renderNotice(plan: 'sandbox' | 'professional') {
  const onUrlUpdate = vi.fn()
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    features: { billing: { subscription: { plan } } },
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  await render(
    <ConsoleProvider>
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <DocumentUploadPlanNotice fileSizeLimitMb={15} />
      </NuqsTestingAdapter>
    </ConsoleProvider>,
  )
  return onUrlUpdate
}

it('shows the free upload constraints and opens the existing pricing flow from the keyboard', async () => {
  const onUrlUpdate = await renderNotice('sandbox')
  await expect.element(page.getByText('billing.upgrade.uploadMultiplePages.title')).toBeVisible()
  await expect
    .element(page.getByText(/datasetCreation\.stepOne\.uploader\.tip:.*"size":15.*"batchCount":1/))
    .toBeVisible()
  await expect
    .element(page.getByText('billing.upgrade.uploadMultipleFiles.title'))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByText('billing.upgrade.uploadMultipleFiles.description'))
    .not.toBeInTheDocument()

  await userEvent.tab()
  const upgrade = page.getByRole('button', { name: 'billing.triggerLimitModal.upgrade' })
  await expect.element(upgrade).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect
    .poll(() => onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('pricing'))
    .toBe('open')
})

it('does not show the free upload notice for a paid plan', async () => {
  await renderNotice('professional')
  await expect
    .element(page.getByText('billing.upgrade.uploadMultiplePages.title'))
    .not.toBeInTheDocument()
  await expect
    .element(page.getByRole('button', { name: 'billing.triggerLimitModal.upgrade' }))
    .not.toBeInTheDocument()
})
