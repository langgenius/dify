import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import VectorSpaceAdmissionAlert from '../vector-space-admission-alert'

const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()

async function renderAlert(showUpgrade: boolean) {
  const { wrapper: ConsoleQuery } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })

  return render(
    <ConsoleQuery>
      <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
        <VectorSpaceAdmissionAlert showUpgrade={showUpgrade} estimatedMb={61} planLimitMb={50} />
      </NuqsTestingAdapter>
    </ConsoleQuery>,
  )
}

beforeEach(() => onUrlUpdate.mockReset())

it('announces the exceeded vector-space estimate without an unavailable upgrade action', async () => {
  await renderAlert(false)

  const alert = page.getByRole('alert')
  await expect.element(alert).toMatchTextContent(/"estimated":61/)
  await expect.element(alert).toMatchTextContent(/"limit":50/)
  await expect
    .element(page.getByRole('button', { name: 'billing.upgradeBtn.encourage' }))
    .not.toBeInTheDocument()
})

it('opens pricing from the available upgrade action', async () => {
  await renderAlert(true)

  await page.getByRole('button', { name: 'billing.upgradeBtn.encourage' }).click()
  await expect.poll(() => onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open')
})
