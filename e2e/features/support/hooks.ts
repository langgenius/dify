import type { Browser, Page } from '@playwright/test'
import type { Buffer } from 'node:buffer'
import type { CleanupTask } from '../../support/cleanup'
import type { DifyWorld } from './world'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, Status } from '@cucumber/cucumber'
import { chromium, webkit } from '@playwright/test'
import { AUTH_BOOTSTRAP_TIMEOUT_MS, ensureAuthenticatedState } from '../../fixtures/auth'
import { deleteTestApp } from '../../support/api'
import { runCleanupTasks, shouldFailForCleanupErrors } from '../../support/cleanup'
import { deleteTestDataset } from '../../support/datasets'
import { getVoiceInputTestMaterialPath } from '../../support/test-materials'
import { deleteBuiltinToolCredential } from '../../support/tools'
import { baseURL, cucumberHeadless, cucumberSlowMo, e2eBrowser } from '../../test-env'
import { deleteTestAgent } from '../agent-v2/support/agent'
import {
  deleteAgentConfigFile,
  deleteAgentConfigSkill,
  deleteAgentDriveFile,
} from '../agent-v2/support/agent-drive'

const e2eRoot = fileURLToPath(new URL('../..', import.meta.url))
const artifactsDir = path.join(e2eRoot, 'cucumber-report', 'artifacts')
const closeSessionHookTimeoutMs = 30_000
const cleanupHookTimeoutMs = 120_000
const diagnosticHookTimeoutMs = 60_000

let browser: Browser | undefined
let microphoneBrowserPromise: Promise<Browser> | undefined

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

BeforeAll({ timeout: AUTH_BOOTSTRAP_TIMEOUT_MS }, async () => {
  await mkdir(artifactsDir, { recursive: true })

  const browserType = e2eBrowser === 'webkit' ? webkit : chromium
  browser = await browserType.launch({
    headless: cucumberHeadless,
    slowMo: cucumberSlowMo,
  })

  console.warn(`[e2e] ${e2eBrowser} session cache bootstrap against ${baseURL}`)
  await ensureAuthenticatedState(browser, baseURL)
})

const getMicrophoneBrowser = () => {
  microphoneBrowserPromise ??= chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-audio-capture=${getVoiceInputTestMaterialPath()}%noloop`,
    ],
    headless: cucumberHeadless,
    slowMo: cucumberSlowMo,
  })

  return microphoneBrowserPromise
}

Before(async function (this: DifyWorld, { pickle }) {
  if (!browser) throw new Error('Shared Playwright browser is not available.')

  const scenarioTags = pickle.tags.map((tag) => tag.name)
  const isMicrophoneScenario = scenarioTags.includes('@microphone')
  const isUnauthenticatedScenario = scenarioTags.includes('@unauthenticated')
  if (isMicrophoneScenario && e2eBrowser !== 'chromium')
    throw new Error('Microphone scenarios require E2E_BROWSER=chromium.')

  const scenarioBrowser = isMicrophoneScenario ? await getMicrophoneBrowser() : browser

  if (isUnauthenticatedScenario) await this.startUnauthenticatedSession(scenarioBrowser)
  else await this.startAuthenticatedSession(scenarioBrowser)

  if (isMicrophoneScenario) {
    if (!this.context)
      throw new Error('Playwright context has not been initialized for the microphone scenario.')

    await this.context.grantPermissions(['microphone'], {
      origin: new URL(baseURL).origin,
    })
  }

  this.scenarioStartedAt = Date.now()

  const tags = scenarioTags.join(' ')
  console.warn(`[e2e] start ${pickle.name}${tags ? ` ${tags}` : ''}`)
})

// Cucumber runs After hooks in reverse registration order: diagnostics, cleanup, then close.
After(
  { name: 'Close browser session', timeout: closeSessionHookTimeoutMs },
  async function (this: DifyWorld, { result }) {
    const closeErrors = await runCleanupTasks([
      { label: 'Close browser session', run: () => this.closeSession() },
    ])
    if (closeErrors.length === 0) return

    const message = `Cleanup errors:\n${closeErrors.join('\n')}`
    this.attach(message, 'text/plain')
    if (shouldFailForCleanupErrors(result?.status)) throw new Error(message)
  },
)

After(
  { name: 'Clean up scenario resources', timeout: cleanupHookTimeoutMs },
  async function (this: DifyWorld, { result }) {
    const cleanupTasks: CleanupTask[] = [
      ...this.createdAgentConfigSkills.toReversed().map((skill) => ({
        label: `Delete Agent config skill ${skill.name}`,
        run: () => deleteAgentConfigSkill(skill.agentId, skill.name),
      })),
      ...this.createdAgentConfigFiles.toReversed().map((file) => ({
        label: `Delete Agent config file ${file.name}`,
        run: () => deleteAgentConfigFile(file.agentId, file.name),
      })),
      ...this.createdAgentDriveFiles.toReversed().map((file) => ({
        label: `Delete Agent drive file ${file.key}`,
        run: () => deleteAgentDriveFile(file.agentId, file.key),
      })),
      ...this.createdAppIds.toReversed().map((id) => ({
        label: `Delete app ${id}`,
        run: () => deleteTestApp(id),
      })),
      ...this.createdAgentIds.toReversed().map((id) => ({
        label: `Delete Agent ${id}`,
        run: () => deleteTestAgent(id),
      })),
      ...this.createdDatasetIds.toReversed().map((id) => ({
        label: `Delete dataset ${id}`,
        run: () => deleteTestDataset(id),
      })),
      ...this.createdBuiltinToolCredentials.toReversed().map((credential) => ({
        label: `Delete builtin tool credential ${credential.provider}/${credential.credentialId}`,
        run: () => deleteBuiltinToolCredential(credential.provider, credential.credentialId),
      })),
    ]

    const cleanupErrors = await runCleanupTasks(cleanupTasks)
    cleanupErrors.push(...(await this.runRegisteredCleanups()))

    if (cleanupErrors.length === 0) return

    const message = `Cleanup errors:\n${cleanupErrors.join('\n')}`
    this.attach(message, 'text/plain')
    if (shouldFailForCleanupErrors(result?.status)) throw new Error(message)
  },
)

After(
  { name: 'Capture scenario diagnostics', timeout: diagnosticHookTimeoutMs },
  async function (this: DifyWorld, { pickle, result }) {
    const elapsedMs = this.scenarioStartedAt ? Date.now() - this.scenarioStartedAt : undefined
    const status = result?.status || Status.UNKNOWN

    console.warn(
      `[e2e] end ${pickle.name} status=${status}${elapsedMs ? ` durationMs=${elapsedMs}` : ''}`,
    )

    if (!diagnosticArtifactStatuses.has(status)) return

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
  },
)

AfterAll(async () => {
  const microphoneBrowser = await microphoneBrowserPromise?.catch(() => undefined)
  await microphoneBrowser?.close()
  await browser?.close()
  microphoneBrowserPromise = undefined
  browser = undefined
})
