import { Given } from '@cucumber/cucumber'
import { getCachedSession } from '../../support/session'
import type { DifyWorld } from '../../support/world'

Given('I am signed in as the default E2E admin', async function (this: DifyWorld) {
  const session = await getCachedSession(this)

  this.attach(
    `Authenticated as ${session.adminEmail} using ${session.mode} flow at ${session.baseURL}.`,
    'text/plain',
  )
})
