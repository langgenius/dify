import type { DifyWorld } from '../../support/world.ts'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

const workflowEditorPath = (world: DifyWorld) => {
  const appId = world.createdAppIds.at(-1)
  if (!appId) throw new Error('A workflow app must be created before testing its protected link.')
  return `/app/${appId}/workflow`
}

When('I follow the workflow editor link without signing in', async function (this: DifyWorld) {
  await this.getPage().goto(workflowEditorPath(this))
})

Then('I should return to the requested workflow editor', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL((url) => url.pathname === workflowEditorPath(this), {
    timeout: 30_000,
  })
  await expect(this.getPage().getByRole('button', { name: /^Test Run\b/ })).toBeVisible()
})
