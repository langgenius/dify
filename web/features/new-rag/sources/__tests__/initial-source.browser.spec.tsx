import { page } from 'vite-plus/test/browser'
import { consoleQuery } from '@/service/console'
import { SourcesPage } from '../page'
import {
  clearSourceClients,
  measurePollIntervalFor,
  renderSources as render,
} from './source-browser-env'
import { source, sourceWorkflow } from './source-fixtures'
import { resetSourceServer, routeState, sourceResponses } from './source-server'

beforeEach(() => {
  resetSourceServer()
})
afterEach(() => {
  clearSourceClients()
  vi.useRealTimers()
})

describe('Sources: initial-source', () => {
  it('polls an empty list every two seconds while awaiting the Initial Source', async () => {
    routeState.awaitInitialSource = 'operation-1'
    sourceResponses.data = { pages: [{ items: [] }] }

    const { queryClient } = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(await measurePollIntervalFor(queryClient, [])).toBe(2000)
    await expect
      .element(page.getByText('knowledgeSources.awaitingInitialSource'))
      .toBeInTheDocument()
    await expect
      .element(page.getByText('knowledgeSources.sourcesEmptyTitle'))
      .not.toBeInTheDocument()
  })

  it('waits for the Initial Source created by the requested operation', async () => {
    routeState.awaitInitialSource = 'operation-1'
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                clientRequestId: 'initial-source:older-operation',
                preview: false,
              },
              status: 'active',
            }),
          ],
        },
      ],
    }

    const { queryClient } = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(await measurePollIntervalFor(queryClient, sourceResponses.data.pages[0]!.items!)).toBe(
      2000,
    )
    await expect
      .element(page.getByText('knowledgeSources.awaitingInitialSource'))
      .toBeInTheDocument()
  })

  it('clears the one-shot URL signal once the requested Initial Source appears', async () => {
    routeState.awaitInitialSource = 'operation-1'
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                clientRequestId: 'initial-website-source:operation-1',
                preview: true,
              },
              status: 'disabled',
            }),
          ],
        },
      ],
    }

    const { navigation } = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await vi.waitFor(async () => {
      expect(navigation.router.replace).toHaveBeenCalledWith('/datasets/new/space-1/sources', {
        scroll: false,
      })
    })
  })

  it('stops awaiting the Initial Source after ten minutes and keeps manual refresh available', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      routeState.awaitInitialSource = 'operation-1'
      sourceResponses.data = { pages: [{ items: [] }] }

      const view = await render(<SourcesPage knowledgeSpaceId="space-1" />)
      const { queryClient } = view
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)

      expect(await measurePollIntervalFor(queryClient, [])).toBe(false)

      sourceResponses.refresh.mockClear()
      await page.getByRole('button', { name: 'knowledgeSources.refreshSources' }).click()
      await vi.waitFor(async () => expect(sourceResponses.refresh).toHaveBeenCalledOnce())

      sourceResponses.data = {
        pages: [
          {
            items: [
              source({
                metadata: {
                  clientRequestId: 'initial-source:operation-1',
                  preview: false,
                },
                status: 'active',
              }),
            ],
          },
        ],
      }
      await view.refresh()

      await expect
        .element(page.getByRole('button', { name: 'knowledgeSources.refreshSources' }))
        .not.toBeInTheDocument()
      expect(await measurePollIntervalFor(queryClient, sourceResponses.data.pages[0]!.items!)).toBe(
        false,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows Initial Sources as initializing or error while keeping ordinary previews hidden', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              id: 'ordinary-preview',
              metadata: { preview: true },
              name: 'Ordinary preview',
              status: 'disabled',
            }),
            source({
              id: 'empty-initial-request',
              metadata: { clientRequestId: 'initial-source:', preview: true },
              name: 'Incomplete Initial Source marker',
              status: 'disabled',
            }),
            source({
              id: 'initializing',
              metadata: {
                clientRequestId: 'initial-source:operation-1',
                preview: true,
              },
              name: 'Initial documents',
              status: 'disabled',
            }),
            source({
              id: 'syncing-initial-source',
              metadata: {
                clientRequestId: 'initial-website-source:operation-3',
                preview: true,
              },
              name: 'Syncing initial website',
              status: 'disabled',
              syncWorkflow: sourceWorkflow('importing'),
            }),
            source({
              id: 'failed',
              metadata: {
                clientRequestId: 'initial-website-source:operation-2',
                initialImport: { state: 'failed' },
                preview: false,
              },
              name: 'Initial website',
              status: 'disabled',
            }),
          ],
        },
      ],
    }

    const { queryClient } = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await expect.element(page.getByText('Ordinary preview')).not.toBeInTheDocument()
    await expect.element(page.getByText('Incomplete Initial Source marker')).not.toBeInTheDocument()
    const initializingRow = page.getByRole('row', { name: /Initial documents/ })
    await expect
      .element(initializingRow.getByRole('status'))
      .toMatchTextContent('Initial documents: knowledgeSpace.sourceStatus.initializing')
    const syncingRow = page.getByRole('row', { name: /Syncing initial website/ })
    await expect
      .element(syncingRow.getByRole('status'))
      .toMatchTextContent('Syncing initial website: knowledgeSpace.sourceStatus.syncing')
    await expect
      .element(
        syncingRow.getByText('knowledgeSources.sourceSyncProgress:{"completed":0,"total":1}'),
      )
      .toBeInTheDocument()
    const failedRow = page.getByRole('row', { name: /Initial website/ })
    await expect
      .element(failedRow.getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.error')

    const listedSources = sourceResponses.data
    expect(
      await measurePollIntervalFor(queryClient, [
        source({
          metadata: {
            clientRequestId: 'initial-source:operation-1',
            preview: true,
          },
          status: 'disabled',
        }),
      ]),
    ).toBe(3000)
    expect(
      await measurePollIntervalFor(queryClient, [
        source({
          metadata: {
            clientRequestId: 'initial-source:operation-1',
            preview: false,
          },
          status: 'active',
        }),
      ]),
    ).toBe(false)
    expect(
      await measurePollIntervalFor(queryClient, [
        source({
          metadata: {
            clientRequestId: 'initial-website-source:operation-2',
            initialImport: { state: 'failed' },
            preview: false,
          },
          status: 'disabled',
        }),
      ]),
    ).toBe(false)

    sourceResponses.data = listedSources
    await queryClient.invalidateQueries({ queryKey: consoleQuery.knowledgeFs.spaces.key() })
    await page
      .getByRole('row', { name: /Initial documents/ })
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Initial documents"}',
      })
      .click()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSpace.openSource' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('menuitem', { name: 'common.operation.edit' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSources.removeSource' }))
      .not.toBeInTheDocument()
  })
})
