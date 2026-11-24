import type { SourceApi } from './source-server'
import { page } from 'vite-plus/test/browser'
import { apiError } from '@/test/fake-api'
import { SourcesPage } from '../page'
import {
  clearSourceClients,
  measurePollIntervalFor,
  renderSources as render,
} from './source-browser-env'
import { source, sourceWorkflow } from './source-fixtures'
import { resetSourceServer, sourceResponse, sourceResponses } from './source-server'

let fake: SourceApi
beforeEach(() => {
  fake = resetSourceServer()
})
afterEach(() => {
  clearSourceClients()
  vi.useRealTimers()
})

describe('Sources: sync-lifecycle', () => {
  it('polls syncing sources and stops once their work is complete', async () => {
    sourceResponses.data = { pages: [{ items: [] }] }
    const { queryClient } = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    expect(await measurePollIntervalFor(queryClient, [source({ status: 'syncing' })])).toBe(3000)
    expect(
      await measurePollIntervalFor(queryClient, [
        source({ syncWorkflow: sourceWorkflow('completed') }),
      ]),
    ).toBe(false)
  })

  it('syncs a source through the real KnowledgeFS action', async () => {
    sourceResponses.data = { pages: [{ items: [source({})] }] }
    let finishRefresh: (() => void) | undefined
    // Holds the list refresh the sync triggers.
    sourceResponses.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )

    const { refresh, queryClient } = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()

    await page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }).click()

    await vi.waitFor(async () =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post,
      ).toHaveBeenCalledWith({
        headers: { 'Idempotency-Key': expect.any(String) },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    await expect
      .element(
        page
          .getByRole('row', { name: /Product documentation/ })
          .getByText('knowledgeSources.sourceSyncProgress:{"completed":0,"total":1}'),
      )
      .toBeInTheDocument()
    finishRefresh?.()
    sourceResponses.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    await refresh()
    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.active')
    await vi.waitFor(async () => expect(sourceResponses.refresh).toHaveBeenCalled())
    expect(
      await measurePollIntervalFor(queryClient, [
        source({ syncWorkflow: sourceWorkflow('completed') }),
      ]),
    ).toBe(false)
  })

  it('restores an active source sync from the server on page load', async () => {
    sourceResponses.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('syncing') })] }],
    }
    const restored = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')

    sourceResponses.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    await restored.refresh()

    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.active')
  })

  it('keeps a disabled source disabled while its sync is active', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              status: 'disabled',
              syncWorkflow: sourceWorkflow('syncing'),
            }),
          ],
        },
      ],
    }

    const { queryClient } = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = page.getByRole('row', { name: /Product documentation/ })
    await expect
      .element(row.getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.disabled')
    await expect
      .element(row.getByRole('status'))
      .not.toMatchTextContent('knowledgeSpace.sourceStatus.syncing')

    await row
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }).click()

    await expect
      .element(row.getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.disabled')
    await expect
      .element(row.getByRole('status'))
      .not.toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    expect(
      await measurePollIntervalFor(queryClient, [
        source({ status: 'disabled', syncWorkflow: sourceWorkflow('syncing') }),
      ]),
    ).toBe(3000)
    expect(
      await measurePollIntervalFor(queryClient, [
        source({ status: 'disabled', syncWorkflow: sourceWorkflow('completed') }),
      ]),
    ).toBe(false)
  })

  it('keeps polling an active sync when enabling a disabled source and refresh fails', async () => {
    const activeWorkflow = sourceWorkflow('syncing')
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              status: 'disabled',
              syncWorkflow: activeWorkflow,
            }),
          ],
        },
      ],
    }
    fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch.mockResolvedValue(
      sourceResponse(
        source({
          status: 'active',
          updatedAt: '2026-07-20T10:01:00Z',
          version: 4,
        }),
      ),
    )
    sourceResponses.refresh.mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Source refresh failed' }),
    )

    const { queryClient } = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    const row = page.getByRole('row', { name: /Product documentation/ })
    await row
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'dataset.enable' }).click()

    await expect
      .element(row.getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    expect(
      await measurePollIntervalFor(queryClient, [
        source({ status: 'disabled', syncWorkflow: activeWorkflow }),
      ]),
    ).toBe(3000)
  })

  it('keeps a failed restored sync visible when the source list reaches a terminal state', async () => {
    sourceResponses.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('syncing') })] }],
    }
    const restored = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              lastSyncedAt: '2026-07-20T09:00:00Z',
              syncWorkflow: {
                ...sourceWorkflow('failed'),
                lastErrorCode: 'KNOWLEDGE_FS_UNAVAILABLE',
              },
            }),
          ],
        },
      ],
    }
    await restored.refresh()

    const row = page.getByRole('row', { name: /Product documentation/ })
    await expect
      .element(
        row.getByRole('button', {
          name: 'knowledgeErrors.taskFailure.temporary',
        }),
      )
      .toBeInTheDocument()
    await expect.element(row.getByText('KNOWLEDGE_FS_UNAVAILABLE')).not.toBeInTheDocument()
    // Only the background refresh that delivered the failure; no extra reload is requested.
    expect(sourceResponses.refresh).toHaveBeenCalledOnce()
  })

  it('reconciles the source list after a sync finishes', async () => {
    sourceResponses.data = { pages: [{ items: [source({})] }] }
    sourceResponses.refresh.mockRejectedValueOnce(
      apiError({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Initial source refresh failed',
      }),
    )

    const rendered = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    const { queryClient } = rendered
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }).click()

    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')

    sourceResponses.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    await rendered.refresh()

    await vi.waitFor(async () => expect(sourceResponses.refresh).toHaveBeenCalled())
    expect(
      await measurePollIntervalFor(queryClient, [
        source({ syncWorkflow: sourceWorkflow('completed') }),
      ]),
    ).toBe(false)
    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.active')
  })

  it('retries an errored source and shows its queued state', async () => {
    sourceResponses.data = { pages: [{ items: [source({ status: 'error' })] }] }
    let finishRefresh: (() => void) | undefined
    // Holds the list refresh the sync triggers.
    sourceResponses.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve
        }),
    )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page.getByRole('button', { name: 'common.operation.retry' }).click()

    await vi.waitFor(async () =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post,
      ).toHaveBeenCalledOnce(),
    )
    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    finishRefresh?.()
  })
})
