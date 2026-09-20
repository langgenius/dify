import type { DifyWorld } from '../../support/world'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { Then } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

Then('an app package named after the app should be downloaded', async function (this: DifyWorld) {
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
  expect(download.suggestedFilename()).toBe(`${appName}.ifpkg`)
  const content = await readFile(await download.path())
  expect(content.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
})
