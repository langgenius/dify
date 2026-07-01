import type { DifyWorld } from '../../support/world'
import { Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'

Then('Agent v2 standalone Output Variables should be available', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByRole('heading', { name: 'Configure' })).toBeVisible({ timeout: 30_000 })

  return skipBlockedPrecondition(
    this,
    'Standalone Agent Output Variables are not available: output variables currently belong to Workflow Agent v2 nodes.',
    {
      owner: 'product',
      remediation: 'Expose standalone Agent Output Variables or keep this scenario excluded until the product path exists.',
    },
  )
})
