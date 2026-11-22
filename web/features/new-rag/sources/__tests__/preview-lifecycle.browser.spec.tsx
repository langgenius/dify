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

describe('Sources: preview-lifecycle', () => {
  it('restores the website Preview action after parameters change during a preview', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    serveWebsitePreview()
    clientMock.getPreviewJob.mockReturnValueOnce(new Promise(() => {}))
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
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await vi.waitFor(async () => expect(clientMock.getPreviewJob).toHaveBeenCalledOnce())
    await page.getByRole('textbox', { name: 'Starting URL' }).fill('https://docs.example.com/guide')

    expect(clientMock.deletePreviewJob).toHaveBeenCalledWith({
      params: { job_id: 'preview-job-1' },
    })
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await expect.element(page.getByRole('checkbox', { name: /Guide/ })).toBeInTheDocument()
    expect(clientMock.startPreviewJob).toHaveBeenCalledTimes(2)
  })

  it('cancels a website preview job whose status read failed before starting another', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    serveWebsitePreview()
    clientMock.startPreviewJob
      .mockResolvedValueOnce({ job_id: 'orphaned-job' })
      .mockResolvedValueOnce({ job_id: 'preview-job-2' })
    clientMock.getPreviewJob.mockRejectedValueOnce(new TypeError('Failed to fetch'))
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
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await expect.element(page.getByRole('alert')).toBeInTheDocument()
    expect(clientMock.deletePreviewJob).not.toHaveBeenCalled()

    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()

    await expect.element(page.getByRole('checkbox', { name: /Guide/ })).toBeInTheDocument()
    expect(clientMock.deletePreviewJob).toHaveBeenCalledWith({
      params: { job_id: 'orphaned-job' },
    })
    expect(clientMock.deletePreviewJob.mock.invocationCallOrder[0]).toBeLessThan(
      clientMock.startPreviewJob.mock.invocationCallOrder[1] ?? 0,
    )
  })

  it('cancels a website preview job that returns after its edit session ends', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    serveWebsitePreview()
    let resolveStaleJob: (value: { job_id: string }) => void = () => {}
    clientMock.startPreviewJob.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleJob = resolve
        }),
    )
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
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await page.getByRole('button', { name: 'common.operation.cancel' }).click()
    resolveStaleJob({ job_id: 'stale-job' })

    await vi.waitFor(() =>
      expect(clientMock.deletePreviewJob).toHaveBeenCalledWith({ params: { job_id: 'stale-job' } }),
    )
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(clientMock.getPreviewJob).not.toHaveBeenCalled()
  })
})
