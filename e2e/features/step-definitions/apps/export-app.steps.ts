import type { DifyWorld } from '../../support/world'
import { Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

Then('a YAML file named after the app should be downloaded', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) {
    throw new Error(
      'No app name stored. Run "there is an existing E2E app available for testing" first.',
    )
  }

  // The export triggers an async API call before the blob download fires.
  // Poll until the download event is captured by the page listener in DifyWorld.
  await expect.poll(() => this.capturedDownloads.length, { timeout: 10_000 }).toBeGreaterThan(0)

  const download = this.capturedDownloads.at(-1)!
  expect(download.suggestedFilename()).toBe(`${appName}.yml`)
})
