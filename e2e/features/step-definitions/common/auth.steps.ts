import { Given } from '@cucumber/cucumber'
import type { DifyWorld } from '../../support/world'

Given('I am signed in as the default E2E admin', async function (this: DifyWorld) {
  const session = await this.getAuthSession()

  this.attach(
    `Authenticated as ${session.adminEmail} using ${session.mode} flow at ${session.baseURL}.`,
    'text/plain',
  )
})

Given('I am not signed in', async function (this: DifyWorld) {
  this.attach(
    'Using a clean browser context without the shared authenticated storage state.',
    'text/plain',
  )
})
