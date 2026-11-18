import type { SourceSyncPolicy } from '../source-models'
import { page } from 'vite-plus/test/browser'
import { SourcesPage } from '../page'
import {
  clearSourceClients,
  lastInput,
  renderSources as render,
  settle,
} from './source-browser-env'
import { firecrawlDatasourcePlugin, notionDatasourcePlugin, source } from './source-fixtures'
import {
  clientMock,
  connectionResponses,
  pluginResponses,
  resetSourceServer,
  serveNotionConnection,
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

describe('Sources: edit-metadata', () => {
  it.each(['upload', 'web'] as const)(
    'edits a %s source name and sync policy without previewing',
    async (type) => {
      pluginResponses.data = [firecrawlDatasourcePlugin]
      const manualPolicy: SourceSyncPolicy = {
        createdAt: '2026-07-20T10:00:00Z',
        enabled: false,
        expectedSourceVersion: 3,
        id: 'policy-1',
        knowledgeSpaceId: 'space-1',
        mode: 'manual',
        revision: 1,
        sourceId: 'source-1',
        updatedAt: '2026-07-20T10:00:00Z',
      }
      const dailyPolicy: SourceSyncPolicy = {
        ...manualPolicy,
        enabled: true,
        expectedSourceVersion: 4,
        mode: 'interval',
        revision: 2,
        updatedAt: '2026-07-20T10:01:00Z',
      }
      sourceResponses.data = {
        pages: [
          {
            items: [
              source({
                ...(type === 'web'
                  ? {
                      connectionId: 'connection-1',
                      metadata: {
                        datasourceParameterMode: 'exact',
                        parameters: { url: 'https://docs.example.com/' },
                        providerName: 'Firecrawl',
                      },
                    }
                  : {}),
                syncPolicy: manualPolicy,
                type,
                uri: type === 'web' ? 'https://docs.example.com/' : 'upload://1',
              }),
            ],
          },
        ],
      }
      clientMock.patchSource.mockResolvedValue(
        source({
          name: 'Renamed documentation',
          syncPolicy: dailyPolicy,
          type,
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

      const nameInput = page.getByRole('textbox', {
        name: 'knowledgeSources.sourceName',
      })
      await nameInput.fill('Renamed documentation')
      await page.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' }).click()
      await page.getByRole('option', { name: 'knowledgeSources.syncPolicyDaily' }).click()
      await page.getByRole('button', { name: 'common.operation.save' }).click()

      await vi.waitFor(async () =>
        expect(clientMock.patchSource).toHaveBeenCalledWith({
          body: {
            expectedVersion: 3,
            name: 'Renamed documentation',
            syncPolicy: { enabled: true, mode: 'interval' },
          },
          params: { control_space_id: 'space-1', source_id: 'source-1' },
        }),
      )
      expect(clientMock.startPreviewJob).not.toHaveBeenCalled()
      await expect
        .element(page.getByRole('row', { name: /Renamed documentation/ }))
        .toBeInTheDocument()
      await expect
        .element(
          page
            .getByRole('row', { name: /Renamed documentation/ })
            .getByText('knowledgeSources.syncPolicyDaily'),
        )
        .toBeInTheDocument()
    },
  )

  it.each(['missing required parameter', 'out-of-range parameter'] as const)(
    'saves metadata without previewing despite a provider constraint: %s',
    async (invalidParameter) => {
      const plugin = structuredClone(firecrawlDatasourcePlugin)
      const datasource = plugin.declaration.datasources![0]
      if (!datasource) throw new Error('Expected the Firecrawl datasource fixture')
      datasource.parameters!.push({
        description: { en_US: '' },
        label: { en_US: 'New required parameter' },
        name: 'new_parameter',
        required: true,
        type: 'string',
      })
      pluginResponses.data = [plugin]
      sourceResponses.data = {
        pages: [
          {
            items: [
              source({
                connectionId: 'connection-1',
                metadata: {
                  datasourceParameterMode: 'exact',
                  providerName: 'Firecrawl',
                  parameters: {
                    url: 'https://docs.example.com/',
                    ...(invalidParameter === 'out-of-range parameter'
                      ? { new_parameter: 'existing value', limit: 500 }
                      : {}),
                  },
                },
              }),
            ],
          },
        ],
      }
      clientMock.patchSource.mockResolvedValue(
        source({ name: 'Renamed documentation', version: 4 }),
      )

      await render(<SourcesPage knowledgeSpaceId="space-1" />)
      await page
        .getByRole('button', {
          name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
        })
        .click()
      await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()
      if (invalidParameter === 'out-of-range parameter')
        await page.getByRole('button', { name: 'knowledgeSources.crawlOptions' }).click()
      await expect
        .element(
          page.getByRole(
            invalidParameter === 'missing required parameter' ? 'textbox' : 'spinbutton',
            {
              name:
                invalidParameter === 'missing required parameter'
                  ? 'New required parameter'
                  : 'Page cap',
            },
          ),
        )
        .toBeInvalid()
      await expect
        .element(page.getByRole('button', { name: 'knowledgeSpace.preview' }))
        .toBeDisabled()
      const nameInput = page.getByRole('textbox', { name: 'knowledgeSources.sourceName' })
      await nameInput.fill('Renamed documentation')
      await page.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' }).click()
      await page.getByRole('option', { name: 'knowledgeSources.syncPolicyDaily' }).click()
      await page.getByRole('button', { name: 'common.operation.save' }).click()

      await vi.waitFor(async () =>
        expect(clientMock.patchSource).toHaveBeenCalledWith({
          body: {
            expectedVersion: 3,
            name: 'Renamed documentation',
            syncPolicy: { enabled: true, mode: 'interval' },
          },
          params: { control_space_id: 'space-1', source_id: 'source-1' },
        }),
      )
      expect(clientMock.startPreviewJob).not.toHaveBeenCalled()
    },
  )

  it('keeps the opening edit snapshot when the source refreshes in the background', async () => {
    pluginResponses.data = [firecrawlDatasourcePlugin]
    const manualPolicy: SourceSyncPolicy = {
      createdAt: '2026-07-20T10:00:00Z',
      enabled: false,
      expectedSourceVersion: 3,
      id: 'policy-1',
      knowledgeSpaceId: 'space-1',
      mode: 'manual',
      revision: 5,
      sourceId: 'source-1',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    const websiteSource = source({
      metadata: {
        datasourceParameterMode: 'exact',
        parameters: { limit: 100, url: 'https://docs.example.com/' },
        providerName: 'Firecrawl',
      },
      syncPolicy: manualPolicy,
      type: 'upload',
      uri: 'upload://1',
    })
    sourceResponses.data = { pages: [{ items: [websiteSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({ name: 'Renamed documentation', syncPolicy: manualPolicy, version: 4 }),
    )

    const { refresh } = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()

    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                datasourceParameterMode: 'exact',
                parameters: { limit: 80, url: 'https://docs.example.com/' },
                providerName: 'Firecrawl',
              },
              syncPolicy: { ...manualPolicy, revision: 6 },
              type: 'upload',
              uri: 'upload://1',
              version: 4,
            }),
          ],
        },
      ],
    }
    await refresh()

    const saveButton = page.getByRole('button', { name: 'common.operation.save' })
    const nameInput = page.getByRole('textbox', { name: 'knowledgeSources.sourceName' })
    await nameInput.fill('Renamed documentation')
    await page.getByRole('combobox', { name: 'knowledgeSources.syncPolicy' }).click()
    await page.getByRole('option', { name: 'knowledgeSources.syncPolicyDaily' }).click()
    await saveButton.click()

    await vi.waitFor(async () =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Renamed documentation',
          syncPolicy: { enabled: true, mode: 'interval' },
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })

  it('does not expose legacy website fields while a provider declaration is loading', async () => {
    pluginResponses.data = undefined
    pluginResponses.pending = true
    const websiteSource = source({
      metadata: {
        datasourceParameterMode: 'exact',
        parameters: { url: 'https://docs.example.com/' },
        providerName: 'Firecrawl',
      },
    })
    sourceResponses.data = { pages: [{ items: [websiteSource] }] }
    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()

    await expect.element(page.getByRole('status', { name: 'common.loading' })).toBeInTheDocument()
    await expect
      .element(page.getByRole('textbox', { name: 'knowledgeSources.rootUrl' }))
      .not.toBeInTheDocument()
    const nameInput = page.getByRole('textbox', {
      name: 'knowledgeSources.sourceName',
    })
    await nameInput.fill('Renamed documentation')
    await expect.element(page.getByRole('button', { name: 'common.operation.save' })).toBeEnabled()
  })

  it('reports provider declaration failures without falling back to legacy fields', async () => {
    pluginResponses.data = undefined
    pluginResponses.failed = true
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
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

    await expect
      .element(page.getByRole('alert'))
      .toMatchTextContent('knowledgeSpace.providerLoadFailed')
    await expect
      .element(page.getByRole('textbox', { name: 'knowledgeSources.rootUrl' }))
      .not.toBeInTheDocument()
  })

  it.each(['web', 'connector'] as const)(
    'recovers the %s source editor through its connection-page retry',
    async (type) => {
      if (type === 'web') serveWebsitePreview()
      else serveNotionConnection()
      const readyPage = connectionResponses.data!.pages[0]!
      connectionResponses.data = { pages: [{ data: [], next_cursor: 'next' }, readyPage] }
      connectionResponses.nextPageError = true
      pluginResponses.data = [type === 'web' ? firecrawlDatasourcePlugin : notionDatasourcePlugin]
      sourceResponses.data = {
        pages: [
          {
            items: [
              source({
                connectionId: type === 'web' ? 'connection-1' : 'connection-notion',
                metadata:
                  type === 'web'
                    ? {
                        providerName: 'Firecrawl',
                        providerKind: 'website',
                        parameters: { url: 'https://docs.example.com/' },
                      }
                    : {
                        providerName: 'Notion',
                        providerKind: 'online-document',
                        parameters: { workspace: 'product' },
                      },
                type,
              }),
            ],
          },
        ],
      }
      await render(<SourcesPage knowledgeSpaceId="space-1" />)
      await page.getByRole('button', { name: /knowledgeSources.sourceActions/ }).click()
      await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()
      const dialog = page.getByRole('dialog')
      await expect.element(dialog.getByText('knowledgeSpace.providerLoadFailed')).toBeVisible()
      connectionResponses.nextPageError = false
      await dialog.getByRole('button', { name: 'common.operation.retry' }).click()
      await expect
        .element(
          dialog.getByRole('textbox', { name: type === 'web' ? 'Starting URL' : 'Workspace' }),
        )
        .toBeVisible()
      await expect
        .element(dialog.getByText('knowledgeSpace.providerLoadFailed'))
        .not.toBeInTheDocument()
    },
  )

  it('loads edit connections with the current control space instead of the remote space id', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              connectionId: 'connection-1',
              knowledgeSpaceId: 'remote-space-1',
              metadata: { providerKind: 'online-document' },
              type: 'connector',
            }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="control-space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()

    await settle()
    expect(lastInput('connections')).toEqual({
      params: { control_space_id: 'control-space-1' },
      query: { limit: 200 },
    })
  })
})
