import type { SourceApi } from './source-server'
import { page } from 'vite-plus/test/browser'
import { apiError, pendingResponse } from '@/test/fake-api'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import { firecrawlDatasourcePlugin, source } from './source-fixtures'
import {
  pluginResponses,
  resetSourceServer,
  serveWebsitePreview,
  sourceResponses,
} from './source-server'

// boundary: the component test controls route inputs and observes navigation destinations.
vi.mock('@/next/navigation', async () => (await import('./source-server')).navigation)

let fake: SourceApi
beforeEach(() => {
  fake = resetSourceServer()
})
afterEach(() => {
  clearSourceClients()
  vi.useRealTimers()
})

describe('Sources: preview-lifecycle', () => {
  it('restores the website Preview action after parameters change during a preview', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    serveWebsitePreview()
    fake.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.get.mockReturnValueOnce(
      pendingResponse(),
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
    await vi.waitFor(async () =>
      expect(
        fake.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.get,
      ).toHaveBeenCalledOnce(),
    )
    await page.getByRole('textbox', { name: 'Starting URL' }).fill('https://docs.example.com/guide')

    expect(fake.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.delete).toHaveBeenCalledWith(
      {
        params: { job_id: 'preview-job-1' },
      },
    )
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await expect.element(page.getByRole('checkbox', { name: /Guide/ })).toBeInTheDocument()
    expect(fake.console.knowledgeFs.sourceProviderPreview.jobs.post).toHaveBeenCalledTimes(2)
  })

  it('cancels a website preview job whose status read failed before starting another', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    serveWebsitePreview()
    fake.console.knowledgeFs.sourceProviderPreview.jobs.post
      .mockResolvedValueOnce({ job_id: 'orphaned-job' })
      .mockResolvedValueOnce({ job_id: 'preview-job-2' })
    fake.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.get.mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Failed to fetch' }),
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
    await expect.element(page.getByRole('alert')).toBeInTheDocument()
    expect(
      fake.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.delete,
    ).not.toHaveBeenCalled()

    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()

    await expect.element(page.getByRole('checkbox', { name: /Guide/ })).toBeInTheDocument()
    expect(fake.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.delete).toHaveBeenCalledWith(
      {
        params: { job_id: 'orphaned-job' },
      },
    )
    expect(
      fake.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.delete.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      fake.console.knowledgeFs.sourceProviderPreview.jobs.post.mock.invocationCallOrder[1] ?? 0,
    )
  })

  it('cancels a website preview job that returns after its edit session ends', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    serveWebsitePreview()
    let resolveStaleJob: (value: { job_id: string }) => void = () => {}
    fake.console.knowledgeFs.sourceProviderPreview.jobs.post.mockImplementationOnce(
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
      expect(
        fake.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.delete,
      ).toHaveBeenCalledWith({ params: { job_id: 'stale-job' } }),
    )
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    expect(fake.console.knowledgeFs.sourceProviderPreview.jobs.byJobId.get).not.toHaveBeenCalled()
  })
})
