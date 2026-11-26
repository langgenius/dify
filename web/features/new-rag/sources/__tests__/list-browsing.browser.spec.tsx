import type { SourceApi } from './source-server'
import { page } from 'vite-plus/test/browser'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import { source, sourceWorkflow } from './source-fixtures'
import { resetSourceServer, sourceResponses } from './source-server'

let fake: SourceApi
beforeEach(() => {
  fake = resetSourceServer()
})
afterEach(() => {
  clearSourceClients()
  vi.useRealTimers()
})

describe('Sources: list-browsing', () => {
  it('loads sources through the KnowledgeFS contract', async () => {
    sourceResponses.pending = true

    await render(<SourcesPage knowledgeSpaceId="space-1" />, { settle: false })

    await expect.element(page.getByRole('progressbar')).toBeInTheDocument()
    await expect
      .poll(() => fake.console.knowledgeFs.spaces.byControlSpaceId.sources.get.mock.lastCall?.[0])
      .toEqual({
        params: { control_space_id: 'space-1' },
        query: { limit: 200 },
      })
  })

  it('renders the designed empty state and exposes source-type shortcuts', async () => {
    sourceResponses.data = { pages: [{ items: [] }] }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await expect.element(page.getByText('knowledgeSources.sourcesEmptyTitle')).toBeInTheDocument()
    await expect
      .element(page.getByRole('heading', { name: 'knowledgeSpace.sources' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('link', { name: 'knowledgeSpace.addSource' }))
      .toHaveAttribute('href', '/datasets/new/space-1/sources/new')
    for (const [name, path] of [
      ['Firecrawl', '/datasets/new/space-1/sources/new?type=websiteCrawl&provider=Firecrawl'],
      ['Jina Reader', '/datasets/new/space-1/sources/new?type=websiteCrawl&provider=Jina+Reader'],
      ['Notion', '/datasets/new/space-1/sources/new?type=onlineDocuments&provider=Notion'],
      ['Google Drive', '/datasets/new/space-1/sources/new?type=onlineDrive&provider=Google+Drive'],
      ['Confluence', '/datasets/new/space-1/sources/new?type=onlineDocuments&provider=Confluence'],
    ] as const) {
      await expect.element(page.getByRole('link', { name })).toHaveAttribute('href', path)
    }
    await expect
      .element(page.getByRole('link', { name: 'knowledgeSpace.moreProviders' }))
      .toHaveAttribute('href', '/datasets/new/space-1/sources/new')
  })

  it('renders real source statuses and filters by status and search text', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({ id: 'active', name: 'Product documentation', status: 'active' }),
            source({
              syncWorkflow: { ...sourceWorkflow('syncing'), sourceId: 'syncing' },
              id: 'syncing',
              name: 'API reference',
              status: 'active',
            }),
            source({ id: 'disabled', name: 'Legacy FAQ', status: 'disabled' }),
            source({ id: 'error', name: 'Support site', status: 'error' }),
          ],
        },
      ],
    }

    const { onUrlUpdate } = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.active')
    await expect
      .element(page.getByRole('row', { name: /API reference/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    await expect
      .element(page.getByRole('row', { name: /Legacy FAQ/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.disabled')
    await expect
      .element(page.getByRole('row', { name: /Support site/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.error')

    const sourceFilter = page.getByRole('combobox', {
      name: 'knowledgeSources.sourceFilterLabel',
    })
    await sourceFilter.click()
    await page.getByRole('option', { name: 'knowledgeSpace.sourceStatus.error' }).click()
    await vi.waitFor(async () => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('status')).toBe('error')
    })
    await expect.element(page.getByText('Support site')).toBeInTheDocument()
    await expect.element(page.getByText('Product documentation')).not.toBeInTheDocument()

    await sourceFilter.click()
    await page.getByRole('option', { name: 'knowledgeSpace.sourceStatus.syncing' }).click()
    await expect.element(page.getByText('API reference')).toBeInTheDocument()
    await expect.element(page.getByText('Product documentation')).not.toBeInTheDocument()

    await sourceFilter.click()
    await page.getByRole('option', { name: 'knowledgeSources.allSources' }).click()
    await page.getByRole('searchbox', { name: 'knowledgeSources.searchSources' }).fill('api')
    await expect.element(page.getByText('API reference')).toBeInTheDocument()
    await expect.element(page.getByText('Support site')).not.toBeInTheDocument()
  })

  it('sorts loaded sources by name from the source column header', async () => {
    await page.viewport(1280, 800)
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({ id: 'zulu', name: 'Zulu docs' }),
            source({ id: 'alpha', name: 'Alpha docs' }),
          ],
        },
      ],
    }

    const { onUrlUpdate } = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await page.getByRole('button', { name: 'knowledgeSpace.sourceColumn' }).click()
    await vi.waitFor(async () => {
      expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.get('sort')).toBe('name-asc')
    })
    const rowsAscending = page.getByRole('row').all().slice(1)
    await expect.element(rowsAscending[0]!.getByText('Alpha docs')).toBeInTheDocument()
    await expect.element(rowsAscending[1]!.getByText('Zulu docs')).toBeInTheDocument()

    await page.getByRole('button', { name: 'knowledgeSpace.sourceColumn' }).click()
    const rowsDescending = page.getByRole('row').all().slice(1)
    await expect.element(rowsDescending[0]!.getByText('Zulu docs')).toBeInTheDocument()
    await expect.element(rowsDescending[1]!.getByText('Alpha docs')).toBeInTheDocument()
  })

  it('places the newest source first until the user selects a name sort', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({ id: 'older', name: 'Older source', createdAt: '2026-07-20T10:00:00Z' }),
            source({ id: 'newer', name: 'Newest source', createdAt: '2026-07-20T10:01:00Z' }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const rows = page.getByRole('row').all().slice(1)
    await expect.element(rows[0]!.getByText('Newest source')).toBeInTheDocument()
    await expect.element(rows[1]!.getByText('Older source')).toBeInTheDocument()
  })

  it('keeps provisional crawl sources out of the source list', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              id: 'preview',
              metadata: { preview: true },
              name: 'Discarded preview',
              status: 'disabled',
            }),
            source({ id: 'connected', name: 'Connected source' }),
            source({
              id: 'submitted-preview',
              metadata: { preview: true },
              name: 'Submitted preview',
              status: 'syncing',
            }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await expect.element(page.getByText('Discarded preview')).not.toBeInTheDocument()
    await expect.element(page.getByText('Connected source')).toBeInTheDocument()
    await expect.element(page.getByText('Submitted preview')).toBeInTheDocument()
  })

  it('supports row selection and a true indeterminate select-all state', async () => {
    await page.viewport(1280, 800)
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({ id: 'first', name: 'First source' }),
            source({ id: 'second', name: 'Second source' }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    const checkboxes = page.getByRole('checkbox').all()
    expect(checkboxes).toHaveLength(3)
    const selectAll = checkboxes[0]
    const firstSource = page.getByRole('row', { name: /First source/ }).getByRole('checkbox')
    const secondSource = page.getByRole('row', { name: /Second source/ }).getByRole('checkbox')
    if (!selectAll || !firstSource || !secondSource) throw new Error('Expected source checkboxes')
    await firstSource.click()
    await expect.element(selectAll).toBePartiallyChecked()

    await selectAll.click()
    await expect.element(firstSource).toBeChecked()
    await expect.element(secondSource).toBeChecked()
  })
})
