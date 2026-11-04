import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { UpgradeModal } from '../upgrade-modal'

it('opens pricing in URL state and applies the public hide action', async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
  const { wrapper: Query } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'CLOUD' },
  })
  const { wrapper: UrlState, onUrlUpdate } = createNuqsTestWrapper()
  function Caller() {
    const [open, setOpen] = useState(true)
    return <UpgradeModal open={open} onOpenChange={setOpen} />
  }
  await render(
    <Query>
      <UrlState>
        <Caller />
      </UrlState>
    </Query>,
  )
  await expect
    .element(
      page
        .getByRole('dialog')
        .getByText('workflowHumanInput.nodes.humanInput.deliveryMethod.upgradeTipContent'),
    )
    .toBeVisible()
  await page.getByRole('button', { name: /billing.upgradeBtn.encourageShort/ }).click()
  await expect.poll(() => onUrlUpdate.mock.lastCall?.[0].searchParams.get('pricing')).toBe('open')
  await page
    .getByRole('button', {
      name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.upgradeTipHide',
    })
    .click()
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
})
