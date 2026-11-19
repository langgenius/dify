import { page } from 'vite-plus/test/browser'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import { firecrawlDatasourcePlugin, source } from './source-fixtures'
import {
  clientMock,
  pluginResponses,
  resetSourceServer,
  serveWebsitePreview,
  sourceResponses,
} from './source-server'

// boundary: the component test controls route inputs and observes navigation destinations.
vi.mock('@/next/navigation', async () => (await import('./source-server')).navigation)
// boundary: replace operation responses while preserving generated queries, observers and business hooks.
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  return (await import('./source-server')).withSourceResponses(actual)
})

const unexpectedFetch = vi.fn(() => Promise.reject(new Error('Unexpected request')))
beforeEach(() => {
  resetSourceServer()
  vi.stubGlobal('fetch', unexpectedFetch)
})
afterEach(() => {
  clearSourceClients()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  expect(unexpectedFetch).not.toHaveBeenCalled()
})

describe('Sources: edit-website', () => {
  it('edits website source parameters from the row menu', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    serveWebsitePreview([
      { source_url: 'https://handbook.example.com/getting-started', title: 'Getting started' },
    ])
    const websiteSource = source({
      connectionId: 'connection-1',
      metadata: {
        crawlOptions: { includeSubpages: true, limit: 100 },
        parameters: {
          url: 'https://docs.example.com/',
        },
        providerId: 'plugin-daemon-website',
        providerName: 'Firecrawl',
      },
      uri: 'https://docs.example.com/',
    })
    sourceResponses.data = { pages: [{ items: [websiteSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({
        metadata: {
          ...websiteSource.metadata,
          crawlOptions: { includeSubpages: true, limit: 50 },
          parameters: {
            crawl_subpages: true,
            limit: 50,
            url: 'https://handbook.example.com/',
          },
        },
        uri: 'https://handbook.example.com/',
        version: 4,
      }),
    )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()

    const rootUrl = page.getByRole('textbox', { name: 'Starting URL' })
    await expect.element(rootUrl).toHaveValue('https://docs.example.com/')
    await rootUrl.fill('https://handbook.example.com')
    await page.getByRole('button', { name: 'knowledgeSources.crawlOptions' }).click()
    await expect.element(page.getByRole('checkbox', { name: 'Follow links' })).toBeChecked()
    const maxPages = page.getByRole('spinbutton', {
      name: 'Page cap',
    })
    await expect.element(maxPages).toHaveValue(100)
    await maxPages.fill('50')
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await page.getByRole('checkbox', { name: /Getting started/ }).click()
    await page.getByRole('button', { name: 'common.operation.save' }).click()

    await vi.waitFor(async () =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Product documentation',
          providerParameters: {
            crawl_subpages: true,
            limit: 50,
            url: 'https://handbook.example.com',
          },
          selection: {
            kind: 'website_crawl',
            sourceUrls: ['https://handbook.example.com/getting-started'],
          },
          syncPolicy: { enabled: false, mode: 'manual' },
          uri: 'https://handbook.example.com/',
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })

  it('requires a new selection only after changing crawl parameters or requesting a preview', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    serveWebsitePreview()
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              connectionId: 'connection-1',
              metadata: {
                datasourceParameterMode: 'exact',
                parameters: { url: 'https://docs.example.com/' },
                providerName: 'Firecrawl',
              },
            }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()
    await page.getByRole('button', { name: 'knowledgeSources.crawlOptions' }).click()

    const followLinks = page.getByRole('checkbox', { name: 'Follow links' })
    const saveButton = page.getByRole('button', { name: 'common.operation.save' })
    await expect.element(followLinks).toBeChecked()
    await expect.element(saveButton).toBeEnabled()

    await followLinks.click()
    await expect.element(saveButton).toBeDisabled()
    await followLinks.click()
    await expect.element(saveButton).toBeEnabled()

    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await expect.element(saveButton).toBeDisabled()
    await page.getByRole('checkbox', { name: /Guide/ }).click()
    await expect.element(saveButton).toBeEnabled()
    await followLinks.click()
    await expect.element(saveButton).toBeDisabled()
  })

  it('removes a cleared optional website provider parameter', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    serveWebsitePreview()
    const websiteSource = source({
      connectionId: 'connection-1',
      metadata: {
        datasourceParameterMode: 'exact',
        parameters: {
          include_paths: '/private/**',
          url: 'https://docs.example.com/',
        },
        providerName: 'Firecrawl',
      },
      uri: 'https://docs.example.com/',
    })
    sourceResponses.data = { pages: [{ items: [websiteSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({
        metadata: {
          ...websiteSource.metadata,
          parameters: {
            crawl_subpages: true,
            limit: 100,
            url: 'https://docs.example.com/',
          },
        },
        version: 4,
      }),
    )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()
    await page.getByRole('button', { name: 'knowledgeSources.crawlOptions' }).click()
    const includedPaths = page.getByRole('textbox', { name: 'Included paths' })
    await expect.element(includedPaths).toHaveValue('/private/**')
    await includedPaths.fill('')
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await page.getByRole('checkbox', { name: /Guide/ }).click()
    await page.getByRole('button', { name: 'common.operation.save' }).click()

    await vi.waitFor(async () =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Product documentation',
          providerParameters: {
            crawl_subpages: true,
            limit: 100,
            url: 'https://docs.example.com/',
          },
          selection: {
            kind: 'website_crawl',
            sourceUrls: ['https://docs.example.com/guide'],
          },
          syncPolicy: { enabled: false, mode: 'manual' },
          uri: 'https://docs.example.com/',
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })
})
