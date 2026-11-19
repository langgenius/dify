import { page } from 'vite-plus/test/browser'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import { source } from './source-fixtures'
import { resetSourceServer, sourceResponses } from './source-server'

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

describe('Source list pagination and recovery', () => {
  it('continues past cursor pages containing only hidden preview drafts', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [source({ id: 'preview', metadata: { preview: true }, status: 'disabled' })],
          nextCursor: 'next',
        },
        { items: [source({ id: 'connected', name: 'Connected source' })] },
      ],
    }
    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await expect.element(page.getByRole('row', { name: /Connected source/ })).toBeVisible()
    await expect
      .element(page.getByText('knowledgeSources.sourcesEmptyTitle'))
      .not.toBeInTheDocument()
  })

  it('recovers the source list through its retry action', async () => {
    sourceResponses.error = new Error('temporary failure')
    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeSources.sourcesErrorTitle' }))
      .toBeVisible()
    sourceResponses.error = null
    sourceResponses.data = { pages: [{ items: [source({ name: 'Recovered documentation' })] }] }
    await page.getByRole('button', { name: 'common.operation.retry' }).click()
    await expect.element(page.getByRole('row', { name: /Recovered documentation/ })).toBeVisible()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeSources.sourcesErrorTitle' }))
      .not.toBeInTheDocument()
  })

  it('appends the next cursor page without replacing earlier sources', async () => {
    sourceResponses.data = {
      pages: [
        { items: [source({ name: 'First page' })], nextCursor: 'next' },
        { items: [source({ id: 'later', name: 'Later page' })] },
      ],
    }
    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await expect.element(page.getByRole('row', { name: /First page/ })).toBeVisible()
    await expect.element(page.getByRole('row', { name: /Later page/ })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'knowledgeSpace.loadMore' }).click()
    await expect.element(page.getByRole('row', { name: /Later page/ })).toBeVisible()
    await expect.element(page.getByRole('row', { name: /First page/ })).toBeVisible()
    await expect
      .element(page.getByRole('button', { name: 'knowledgeSpace.loadMore' }))
      .not.toBeInTheDocument()
  })

  it('offers continuation from an empty cursor page instead of declaring the list empty', async () => {
    sourceResponses.data = {
      pages: [{ items: [], nextCursor: 'next' }, { items: [source({ name: 'Later page' })] }],
    }
    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await expect
      .element(page.getByText('knowledgeSources.sourcesEmptyTitle'))
      .not.toBeInTheDocument()
    await page.getByRole('button', { name: 'knowledgeSpace.loadMore' }).click()
    await expect.element(page.getByRole('row', { name: /Later page/ })).toBeVisible()
  })

  it('finds a matching source on a later cursor page before declaring a search empty', async () => {
    sourceResponses.data = {
      pages: [
        { items: [source({})], nextCursor: 'next' },
        { items: [source({ id: 'later', name: 'Later page match' })] },
      ],
    }
    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page.getByRole('searchbox', { name: 'knowledgeSources.searchSources' }).fill('Later page')
    await expect.element(page.getByRole('row', { name: /Later page match/ })).toBeVisible()
    await expect.element(page.getByText('Product documentation')).not.toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeSources.noMatchingSources'))
      .not.toBeInTheDocument()
  })

  it('limits automatic filtered pagination and lets the user continue manually', async () => {
    sourceResponses.data = {
      pages: [
        ...Array.from({ length: 5 }, (_, index) => ({
          items: [source({ id: `source-${index}`, name: `Source ${index}` })],
          nextCursor: `cursor-${index + 1}`,
        })),
        { items: [source({ id: 'match', name: 'Later page match' })] },
      ],
    }
    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page.getByRole('searchbox', { name: 'knowledgeSources.searchSources' }).fill('Later page')
    await vi.waitFor(() => expect(sourceResponses.next).toHaveBeenCalledTimes(4))
    const more = page.getByRole('button', { name: 'knowledgeSpace.loadMore' })
    await expect.element(more).toBeEnabled()
    await expect
      .element(page.getByRole('row', { name: /Later page match/ }))
      .not.toBeInTheDocument()
    await more.click()
    await expect.element(page.getByRole('row', { name: /Later page match/ })).toBeVisible()
    await expect.element(more).not.toBeInTheDocument()
  })

  it('stops automatic filtered pagination after a cursor error without declaring the search empty', async () => {
    sourceResponses.data = {
      pages: [
        { items: [source({})], nextCursor: 'next' },
        { items: [source({ id: 'later', name: 'Later page match' })] },
      ],
    }
    sourceResponses.nextPageError = true
    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page.getByRole('searchbox', { name: 'knowledgeSources.searchSources' }).fill('Later page')
    await expect.element(page.getByRole('alert')).toBeVisible()
    await expect.element(page.getByRole('progressbar')).not.toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeSources.noMatchingSources'))
      .not.toBeInTheDocument()
    expect(sourceResponses.next).toHaveBeenCalledOnce()
  })
})
