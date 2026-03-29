import { After, AfterAll, Before, BeforeAll, Status, setDefaultTimeout } from '@cucumber/cucumber'
import { chromium, type Browser } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAuthenticatedState } from '../../fixtures/auth'
import { baseURL, cucumberHeadless, cucumberSlowMo } from '../../test-env'
import type { DifyWorld } from './world'

const e2eRoot = fileURLToPath(new URL('../..', import.meta.url))
const artifactsDir = path.join(e2eRoot, 'cucumber-report', 'artifacts')

let browser: Browser | undefined

setDefaultTimeout(60_000)

const sanitizeForPath = (value: string) =>
  value.replaceAll(/[^a-zA-Z0-9_-]+/g, '-').replaceAll(/^-+|-+$/g, '')

const writeArtifact = async (
  scenarioName: string,
  extension: 'html' | 'png',
  contents: Buffer | string,
) => {
  const artifactPath = path.join(
    artifactsDir,
    `${Date.now()}-${sanitizeForPath(scenarioName || 'scenario')}.${extension}`,
  )
  await writeFile(artifactPath, contents)

  return artifactPath
}

BeforeAll(async () => {
  await mkdir(artifactsDir, { recursive: true })

  browser = await chromium.launch({
    headless: cucumberHeadless,
    slowMo: cucumberSlowMo,
  })

  console.log(`[e2e] session cache bootstrap against ${baseURL}`)
  await ensureAuthenticatedState(browser, baseURL)
})

Before(async function (this: DifyWorld, { pickle }) {
  if (!browser) throw new Error('Shared Playwright browser is not available.')

  await this.startAuthenticatedSession(browser)
  this.scenarioStartedAt = Date.now()

  const tags = pickle.tags.map((tag) => tag.name).join(' ')
  console.log(`[e2e] start ${pickle.name}${tags ? ` ${tags}` : ''}`)
})

After(async function (this: DifyWorld, { pickle, result }) {
  const elapsedMs = this.scenarioStartedAt ? Date.now() - this.scenarioStartedAt : undefined

  if (result?.status !== Status.PASSED && this.page) {
    const screenshot = await this.page.screenshot({
      fullPage: true,
    })
    const screenshotPath = await writeArtifact(pickle.name, 'png', screenshot)
    this.attach(screenshot, 'image/png')

    const html = await this.page.content()
    const htmlPath = await writeArtifact(pickle.name, 'html', html)
    this.attach(html, 'text/html')

    if (this.consoleErrors.length > 0)
      this.attach(`Console Errors:\n${this.consoleErrors.join('\n')}`, 'text/plain')

    if (this.pageErrors.length > 0)
      this.attach(`Page Errors:\n${this.pageErrors.join('\n')}`, 'text/plain')

    this.attach(`Artifacts:\n${[screenshotPath, htmlPath].join('\n')}`, 'text/plain')
  }

  const status = result?.status || 'UNKNOWN'
  console.log(
    `[e2e] end ${pickle.name} status=${status}${elapsedMs ? ` durationMs=${elapsedMs}` : ''}`,
  )

  await this.closeSession()
})

AfterAll(async () => {
  await browser?.close()
  browser = undefined
})
