import type { DifyWorld } from '../../support/world'
import { When } from '@cucumber/cucumber'

When('I navigate to the app overview page', async function (this: DifyWorld) {
  const appId = this.createdAppIds.at(-1)
  await this.getPage().goto(`/app/${appId}/overview`)
})
