import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { resolveNewRagSmokeConfig } from '../../../scripts/run-new-rag-smoke'
import { createApiContext, expectApiResponseOK } from '../../../support/api'
import { bootstrapMarketplacePlugins } from '../../../support/marketplace-plugins'
import { createE2EResourceName } from '../../../support/naming'
import {
  assertKnowledgeFsAccessBoundaries,
  deleteKnowledgeFsSpace,
} from '../../new-rag/support/runtime'

const knowledgeFsProxyPath = '/console/api/knowledge-fs/'

const humanizeFieldName = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())

const readSystemFeatures = async () => {
  const context = await createApiContext()
  try {
    const response = await context.get('/console/api/system-features')
    await expectApiResponseOK(response, 'Read E2E system features')
    return (await response.json()) as GetSystemFeaturesResponse
  } finally {
    await context.dispose()
  }
}

Given('the Firecrawl datasource plugin is installed', { timeout: 360_000 }, async () => {
  const result = await bootstrapMarketplacePlugins(
    { dryRun: false, resources: new Map() },
    {
      defaultPluginIds: ['langgenius/firecrawl_datasource'],
      pluginIdsEnv: 'E2E_NEW_RAG_PLUGIN_IDS',
      title: 'New RAG Firecrawl datasource plugin',
    },
  )
  if (result.status === 'blocked')
    throw new Error(result.reason ?? 'The Firecrawl datasource plugin could not be installed.')
})

Given('I monitor New RAG network requests', async function (this: DifyWorld) {
  const page = this.getPage()
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.includes(knowledgeFsProxyPath))
      this.newRag.knowledgeFsRequests.push(request.url())
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (!url.pathname.includes(knowledgeFsProxyPath)) return
    const traceId = response.headers()['x-trace-id']
    this.newRag.knowledgeFsResponses.push({
      method: response.request().method(),
      status: response.status(),
      ...(traceId ? { traceId } : {}),
      url: response.url(),
    })
  })
})

When('I open the Knowledge console', async function (this: DifyWorld) {
  await this.getPage().goto('/datasets')
  await expect(
    this.getPage().getByRole('heading', { name: 'Knowledge', exact: true }),
  ).toBeVisible()
})

Then('the New RAG feature should be disabled by {string}', async (expectedMode: string) => {
  expect(process.env.E2E_NEW_RAG_EXPECTED_FLAG_MODE).toBe(expectedMode)
  expect((await readSystemFeatures()).knowledge_fs_enabled).toBe(false)
})

Then('the New RAG feature should be enabled', async function (this: DifyWorld) {
  expect(process.env.E2E_NEW_RAG_EXPECTED_FLAG_MODE).toBe('enabled')
  expect((await readSystemFeatures()).knowledge_fs_enabled).toBe(true)
  await expect(this.getPage().getByRole('button', { name: 'New', exact: true })).toBeVisible()
})

Then('the Legacy Knowledge view should remain available', async function (this: DifyWorld) {
  const legacyView = this.getPage().getByRole('button', { name: 'Legacy', exact: true })
  await expect(legacyView).toBeVisible()
  await expect(legacyView).toHaveAttribute('aria-pressed', 'true')
})

Then('the New Knowledge view should be unavailable', async function (this: DifyWorld) {
  await expect(this.getPage().getByRole('button', { name: 'New', exact: true })).toHaveCount(0)
})

When('I try to open the New Knowledge creation route', async function (this: DifyWorld) {
  await this.getPage().goto('/datasets/new/create')
})

Then('I should return to the Legacy Knowledge console', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/datasets(?:\?.*)?$/)
  await expect(
    this.getPage().getByRole('heading', { name: 'Knowledge', exact: true }),
  ).toBeVisible()
})

Then('no KnowledgeFS request should leave the browser', async function (this: DifyWorld) {
  expect(this.newRag.knowledgeFsRequests).toEqual([])
  expect(this.newRag.knowledgeFsResponses).toEqual([])
})

When('I switch to the New Knowledge view', async function (this: DifyWorld) {
  const page = this.getPage()
  const guide = page.getByRole('dialog', { name: 'Meet the new Knowledge Base ✨' })
  await expect(guide).toBeVisible()
  await guide.getByRole('button', { name: 'Got it' }).click()
  await page.getByRole('button', { name: 'New', exact: true }).click()
  await expect(page.getByRole('region', { name: 'New', exact: true })).toBeVisible()
})

When('I create a private E2E Knowledge space', async function (this: DifyWorld) {
  const page = this.getPage()
  const name = createE2EResourceName('New RAG Knowledge')
  await page.getByRole('link', { name: 'Create' }).click()
  await expect(page.getByRole('heading', { name: 'Create Knowledge' })).toBeVisible()
  await page.getByLabel('Knowledge name').fill(name)
  await page.getByLabel('Description').fill('New RAG end-to-end release smoke resource')
  const permission = page.getByRole('combobox', { name: 'Permission' })
  if (await permission.isEnabled()) {
    await permission.click()
    await page.getByRole('option', { name: 'Only me' }).click()
  } else {
    await expect(permission).toBeDisabled()
    await expect(permission).toContainText('Only me')
  }
  await page.getByRole('button', { name: 'Create Knowledge' }).click()
  await expect(page).toHaveURL(/\/datasets\/new\/([^/]+)\/sources$/)
  const match = page.url().match(/\/datasets\/new\/([^/]+)\/sources$/)
  const knowledgeSpaceId = match?.[1]
  if (!knowledgeSpaceId) throw new Error('Created Knowledge route did not include a space id.')
  this.newRag.knowledgeSpaceId = knowledgeSpaceId
  this.newRag.knowledgeSpaceName = name
  this.registerCleanup(() => deleteKnowledgeFsSpace(knowledgeSpaceId))
  await expect(page.getByRole('heading', { name })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No sources connected yet' })).toBeVisible()
})

When('I connect the configured Firecrawl provider', async function (this: DifyWorld) {
  const page = this.getPage()
  const config = resolveNewRagSmokeConfig(process.env)
  await page.getByRole('link', { name: 'Add source' }).click()
  await expect(page.getByRole('heading', { name: 'Add source' })).toBeVisible()
  await page.getByRole('button', { name: 'Configure Firecrawl' }).click()
  for (const [field, value] of Object.entries(config.connectionCredentials))
    await page.getByLabel(humanizeFieldName(field)).fill(value)
  await page.getByRole('button', { name: 'Connect Firecrawl' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Firecrawl connected' })).toBeVisible({
    timeout: 60_000,
  })
})

When('I crawl the configured website', { timeout: 210_000 }, async function (this: DifyWorld) {
  const page = this.getPage()
  const config = resolveNewRagSmokeConfig(process.env)
  const sourceName = createE2EResourceName('Website Source')
  this.newRag.sourceName = sourceName
  await page.getByLabel('Root URL').fill(config.crawlUrl)
  await page.getByLabel('Source name').fill(sourceName)
  await page.getByRole('button', { name: 'Crawl & preview' }).click()
  await expect(page.getByRole('checkbox', { name: 'Select all' })).toBeVisible({
    timeout: 180_000,
  })
})

When('I select every crawled page with a manual sync policy', async function (this: DifyWorld) {
  const page = this.getPage()
  await page.getByRole('checkbox', { name: 'Select all' }).click()
  await page.getByLabel('Sync policy').selectOption({ label: 'Manual only' })
  await page.getByRole('button', { name: 'Add source' }).click()
  await expect(page).toHaveURL(/\/datasets\/new\/[^/]+\/sources$/)
})

Then(
  'the website source should become active',
  { timeout: 210_000 },
  async function (this: DifyWorld) {
    const sourceName = this.newRag.sourceName
    if (!sourceName) throw new Error('The New RAG smoke source name is missing.')
    const row = this.getPage().getByRole('row').filter({ hasText: sourceName })
    await expect(row).toContainText('Active', { timeout: 180_000 })
  },
)

When('I open the source Documents', async function (this: DifyWorld) {
  const page = this.getPage()
  await page.getByRole('link', { name: 'Documents' }).click()
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
})

Then(
  'a crawled document should become ready',
  { timeout: 210_000 },
  async function (this: DifyWorld) {
    const page = this.getPage()
    const table = page.getByRole('table')
    const documentLink = table.getByRole('link').first()
    await expect(documentLink).toBeVisible({ timeout: 180_000 })
    const row = page.getByRole('row').filter({ has: documentLink })
    await expect(row).toContainText('Ready', { timeout: 180_000 })
    this.newRag.documentTitle = (await documentLink.textContent())?.trim()
  },
)

When('I open the ready document', async function (this: DifyWorld) {
  const title = this.newRag.documentTitle
  if (!title) throw new Error('The ready New RAG document title is missing.')
  const page = this.getPage()
  await page.getByRole('table').getByRole('link', { name: title }).click()
  await expect(page).toHaveURL(/\/datasets\/new\/[^/]+\/documents\/[^/]+$/)
  this.newRag.documentUrl = page.url()
})

Then('I should see its revision and chunk tree', async function (this: DifyWorld) {
  const title = this.newRag.documentTitle
  if (!title) throw new Error('The ready New RAG document title is missing.')
  const page = this.getPage()
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Revision' })).toBeVisible()
  await expect(page.getByRole('tree')).toBeVisible()
})

Then('the same document detail should be restored', async function (this: DifyWorld) {
  const { documentTitle, documentUrl } = this.newRag
  if (!documentTitle || !documentUrl) throw new Error('The document restore checkpoint is missing.')
  await expect(this.getPage()).toHaveURL(documentUrl)
  await expect(this.getPage().getByRole('heading', { name: documentTitle })).toBeVisible()
  await expect(this.getPage().getByRole('tree')).toBeVisible()
})

Then(
  'the KnowledgeFS tenant and read-only boundaries should hold',
  async function (this: DifyWorld) {
    const knowledgeSpaceId = this.newRag.knowledgeSpaceId
    if (!knowledgeSpaceId) throw new Error('The New RAG smoke Knowledge id is missing.')
    await assertKnowledgeFsAccessBoundaries(knowledgeSpaceId)
  },
)

Then('the New RAG requests should be proxied with diagnostics', async function (this: DifyWorld) {
  const config = resolveNewRagSmokeConfig(process.env)
  expect(this.newRag.knowledgeFsRequests.length).toBeGreaterThan(0)
  expect(
    this.newRag.knowledgeFsRequests.every((url) =>
      new URL(url).pathname.includes(knowledgeFsProxyPath),
    ),
  ).toBe(true)
  expect(
    this.newRag.knowledgeFsRequests.every(
      (url) => new URL(url).origin !== new URL(config.knowledgeFsBaseUrl).origin,
    ),
  ).toBe(true)
  expect(this.newRag.knowledgeFsResponses.some((response) => response.method !== 'GET')).toBe(true)
  expect(this.newRag.knowledgeFsResponses.every((response) => response.status < 400)).toBe(true)
  expect(
    this.newRag.knowledgeFsResponses
      .filter((response) => response.method !== 'GET')
      .every((response) => Boolean(response.traceId)),
  ).toBe(true)
})
