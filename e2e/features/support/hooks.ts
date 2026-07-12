import type { Browser, Page } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import type { DifyWorld } from './world'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, Status } from '@cucumber/cucumber'
import { chromium } from '@playwright/test'
import { AUTH_BOOTSTRAP_TIMEOUT_MS, ensureAuthenticatedState } from '../../fixtures/auth'
import { deleteTestApp } from '../../support/api'
import { deleteTestDataset } from '../../support/datasets'
import { deleteBuiltinToolCredential } from '../../support/tools'
import { baseURL, cucumberHeadless, cucumberSlowMo } from '../../test-env'
import { deleteTestAgent } from '../agent-v2/support/agent'
import {
  deleteAgentConfigFile,
  deleteAgentConfigSkill,
  deleteAgentDriveFile,
} from '../agent-v2/support/agent-drive'

const e2eRoot = fileURLToPath(new URL('../..', import.meta.url))
const artifactsDir = path.join(e2eRoot, 'cucumber-report', 'artifacts')

let browser: Browser | undefined

setDefaultTimeout(60_000)

const diagnosticArtifactStatuses = new Set([
  Status.FAILED,
  Status.AMBIGUOUS,
  Status.PENDING,
  Status.UNDEFINED,
  Status.UNKNOWN,
])

const sanitizeForPath = (value: string) =>
  value.replaceAll(/[^\w-]+/g, '-').replaceAll(/^-+|-+$/g, '')

const writeArtifact = async (
  scenarioName: string,
  label: string,
  extension: 'html' | 'png',
  contents: Buffer | string,
) => {
  const artifactPath = path.join(
    artifactsDir,
    `${Date.now()}-${sanitizeForPath(scenarioName || 'scenario')}-${sanitizeForPath(label)}.${extension}`,
  )
  await writeFile(artifactPath, contents)

  return artifactPath
}

const uniqueDiagnosticPages = (pages: { label: string; page: Page | undefined }[]) => {
  const seen = new Set<Page>()

  return pages.filter(({ page }) => {
    if (!page || page.isClosed() || seen.has(page)) return false

    seen.add(page)
    return true
  }) as { label: string; page: Page }[]
}

const captureDiagnosticPage = async (
  world: DifyWorld,
  scenarioName: string,
  label: string,
  page: Page,
) => {
  const screenshot = await page.screenshot({
    fullPage: true,
  })
  const screenshotPath = await writeArtifact(scenarioName, label, 'png', screenshot)
  world.attach(screenshot, 'image/png')

  const html = await page.content()
  const htmlPath = await writeArtifact(scenarioName, label, 'html', html)
  world.attach(html, 'text/html')

  return [screenshotPath, htmlPath]
}

const recordCleanup = async (errors: string[], label: string, cleanup: () => Promise<void>) => {
  try {
    await cleanup()
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

BeforeAll({ timeout: AUTH_BOOTSTRAP_TIMEOUT_MS }, async () => {
  await mkdir(artifactsDir, { recursive: true })

  browser = await chromium.launch({
    headless: cucumberHeadless,
    slowMo: cucumberSlowMo,
  })

  console.warn(`[e2e] session cache bootstrap against ${baseURL}`)
  await ensureAuthenticatedState(browser, baseURL)
})

Before(async function (this: DifyWorld, { pickle }) {
  if (!browser) throw new Error('Shared Playwright browser is not available.')

  const isUnauthenticatedScenario = pickle.tags.some((tag) => tag.name === '@unauthenticated')

  if (isUnauthenticatedScenario) await this.startUnauthenticatedSession(browser)
  else await this.startAuthenticatedSession(browser)

  this.scenarioStartedAt = Date.now()

  const tags = pickle.tags.map((tag) => tag.name).join(' ')
  console.warn(`[e2e] start ${pickle.name}${tags ? ` ${tags}` : ''}`)
})

After(async function (this: DifyWorld, { pickle, result }) {
  const elapsedMs = this.scenarioStartedAt ? Date.now() - this.scenarioStartedAt : undefined
  const status = result?.status || Status.UNKNOWN

  if (diagnosticArtifactStatuses.has(status)) {
    const artifactPaths: string[] = []
    const artifactErrors: string[] = []
    const diagnosticPages = uniqueDiagnosticPages([
      { label: 'main-page', page: this.page },
      { label: 'agent-v2-web-app', page: this.agentBuilder.accessPoint.webAppPage },
      { label: 'agent-v2-api-reference', page: this.agentBuilder.accessPoint.apiReferencePage },
      {
        label: 'agent-v2-workflow-reference',
        page: this.agentBuilder.accessPoint.workflowReferencePage,
      },
      { label: 'agent-v2-concurrent-configure', page: this.agentBuilder.configure.concurrentPage },
      { label: 'agent-v2-workflow-console', page: this.agentBuilder.workflow.agentConsolePage },
    ])

    for (const { label, page } of diagnosticPages) {
      try {
        artifactPaths.push(...(await captureDiagnosticPage(this, pickle.name, label, page)))
      } catch (error) {
        artifactErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (this.consoleErrors.length > 0)
      this.attach(`Console Errors:\n${this.consoleErrors.join('\n')}`, 'text/plain')

    if (this.pageErrors.length > 0)
      this.attach(`Page Errors:\n${this.pageErrors.join('\n')}`, 'text/plain')

    if (artifactErrors.length > 0)
      this.attach(`Artifact Errors:\n${artifactErrors.join('\n')}`, 'text/plain')

    if (artifactPaths.length > 0)
      this.attach(`Artifacts:\n${artifactPaths.join('\n')}`, 'text/plain')
  }

  console.warn(
    `[e2e] end ${pickle.name} status=${status}${elapsedMs ? ` durationMs=${elapsedMs}` : ''}`,
  )

  const cleanupErrors: string[] = []

  for (const skill of this.createdAgentConfigSkills.toReversed()) {
    await recordCleanup(cleanupErrors, `Delete Agent config skill ${skill.name}`, () =>
      deleteAgentConfigSkill(skill.agentId, skill.name),
    )
  }
  for (const file of this.createdAgentConfigFiles.toReversed()) {
    await recordCleanup(cleanupErrors, `Delete Agent config file ${file.name}`, () =>
      deleteAgentConfigFile(file.agentId, file.name),
    )
  }
  for (const file of this.createdAgentDriveFiles.toReversed()) {
    await recordCleanup(cleanupErrors, `Delete Agent drive file ${file.key}`, () =>
      deleteAgentDriveFile(file.agentId, file.key),
    )
  }
  for (const id of this.createdAppIds)
    await recordCleanup(cleanupErrors, `Delete app ${id}`, () => deleteTestApp(id))
  for (const id of this.createdAgentIds)
    await recordCleanup(cleanupErrors, `Delete Agent ${id}`, () => deleteTestAgent(id))
  for (const id of this.createdDatasetIds)
    await recordCleanup(cleanupErrors, `Delete dataset ${id}`, () => deleteTestDataset(id))
  for (const credential of this.createdBuiltinToolCredentials.toReversed()) {
    await recordCleanup(
      cleanupErrors,
      `Delete builtin tool credential ${credential.provider}/${credential.credentialId}`,
      () => deleteBuiltinToolCredential(credential.provider, credential.credentialId),
    )
  }
  if (cleanupErrors.length > 0)
    this.attach(`Typed cleanup errors:\n${cleanupErrors.join('\n')}`, 'text/plain')
  await this.runRegisteredCleanups()

  await this.closeSession()
})

AfterAll(async () => {
  await browser?.close()
  browser = undefined
})
