import type { Locator } from 'vite-plus/test/browser'
import { cdp, server } from 'vite-plus/test/browser'

/** Supply an OS-style file payload. Chromium strips Files from page-authored drag sources. */
export async function dropFixtureFile(target: Locator, fixture: string) {
  await expect.element(target).toBeVisible()
  await target.hover()
  const bounds = target.element().getBoundingClientRect()
  const data = { items: [], files: [`${server.config.root}/${fixture}`], dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp().send('Input.dispatchDragEvent', {
      type,
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      data,
    })
  }
}
