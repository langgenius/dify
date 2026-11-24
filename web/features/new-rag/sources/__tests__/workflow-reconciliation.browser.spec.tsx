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
import { resetSourceServer, sourceResponses, workflowResponse } from './source-server'

let fake: SourceApi
beforeEach(() => {
  fake = resetSourceServer()
})
afterEach(() => {
  clearSourceClients()
  vi.useRealTimers()
})

describe('Sources: workflow-reconciliation', () => {
  it('tracks a newer server workflow after a local sync completes', async () => {
    sourceResponses.data = { pages: [{ items: [source({})] }] }

    const rendered = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }).click()

    sourceResponses.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    await rendered.refresh()
    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.active')

    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              syncWorkflow: { ...sourceWorkflow('syncing'), id: 'workflow-2' },
            }),
          ],
        },
      ],
    }
    await rendered.refresh()

    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
  })

  it('replaces a local active sync with a newer terminal server workflow', async () => {
    sourceResponses.data = { pages: [{ items: [source({})] }] }

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
      pages: [
        {
          items: [
            source({
              syncWorkflow: {
                ...sourceWorkflow('completed'),
                createdAt: '2026-07-20T11:00:00Z',
                id: 'workflow-2',
                updatedAt: '2026-07-20T11:01:00Z',
              },
            }),
          ],
        },
      ],
    }
    await rendered.refresh()

    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.active')
    expect(
      await measurePollIntervalFor(queryClient, [
        source({
          syncWorkflow: {
            ...sourceWorkflow('completed'),
            createdAt: '2026-07-20T11:00:00Z',
            id: 'workflow-2',
            updatedAt: '2026-07-20T11:01:00Z',
          },
        }),
      ]),
    ).toBe(false)
  })

  it('tracks an older workflow when the server has retried it', async () => {
    sourceResponses.data = { pages: [{ items: [source({})] }] }
    fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post.mockResolvedValue(
      {
        ...workflowResponse('completed'),
        created_at: '2026-07-20T11:00:00Z',
        id: 'newer-terminal-workflow',
        updated_at: '2026-07-20T11:01:00Z',
      },
    )

    const rendered = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    const { queryClient } = rendered
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }).click()

    const retriedWorkflow = {
      ...sourceWorkflow('syncing'),
      createdAt: '2026-07-20T09:00:00Z',
      id: 'older-retried-workflow',
      updatedAt: '2026-07-20T12:00:00Z',
    }
    sourceResponses.data = {
      pages: [{ items: [source({ syncWorkflow: retriedWorkflow })] }],
    }
    await rendered.refresh()

    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    expect(
      await measurePollIntervalFor(queryClient, [source({ syncWorkflow: retriedWorkflow })]),
    ).toBe(3000)
  })

  it('keeps a newly accepted sync visible when the source list still has an older workflow', async () => {
    sourceResponses.data = {
      pages: [{ items: [source({ syncWorkflow: sourceWorkflow('completed') })] }],
    }
    fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post.mockResolvedValue(
      {
        ...workflowResponse(),
        created_at: '2026-07-20T11:00:00Z',
        id: 'workflow-2',
        updated_at: '2026-07-20T11:00:00Z',
      },
    )
    sourceResponses.refresh.mockRejectedValueOnce(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Source refresh failed' }),
    )

    const { queryClient } = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }).click()

    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    expect(
      await measurePollIntervalFor(queryClient, [
        source({ syncWorkflow: sourceWorkflow('completed') }),
      ]),
    ).toBe(3000)
  })
})
