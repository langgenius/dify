import type { SourceWorkflowRun } from '../source-models'
import type { SourceApi } from './source-server'
import { page } from 'vite-plus/test/browser'
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

describe('Sources: import-retry', () => {
  it('retries the failed Initial Source workflow instead of starting a generic sync', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                clientRequestId: 'initial-source:operation-1',
                initialImport: {
                  state: 'failed',
                  workflowId: 'initial-workflow',
                },
                preview: false,
              },
              name: 'Failed Initial Source',
              status: 'disabled',
            }),
          ],
        },
      ],
    }
    fake.console.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post.mockResolvedValue(
      {
        ...workflowResponse(),
        id: 'initial-workflow',
      },
    )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const sourceRow = page.getByRole('row', { name: /Failed Initial Source/ })
    await sourceRow.getByRole('button', { name: 'common.operation.retry' }).click()

    await vi.waitFor(async () => {
      await expect
        .element(sourceRow.getByRole('status'))
        .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    })
    await expect
      .element(sourceRow.getByRole('button', { name: 'common.operation.retry' }))
      .not.toBeInTheDocument()
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post,
    ).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', run_id: 'initial-workflow' },
    })
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post,
    ).not.toHaveBeenCalled()

    await sourceRow
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Failed Initial Source"}',
      })
      .click()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }))
      .not.toBeInTheDocument()
  })

  it('retries a failed async import workflow instead of starting a generic sync', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                lastImport: {
                  kind: 'online-document-import',
                  state: 'failed',
                  syncPolicy: { enabled: true, mode: 'interval' },
                  workflowId: 'import-workflow',
                },
                preview: false,
              },
              name: 'Failed connected source',
              status: 'error',
            }),
          ],
        },
      ],
    }
    fake.console.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post.mockResolvedValue(
      {
        ...workflowResponse(),
        execution_attempts: 2,
        updated_at: '2026-07-20T10:01:00Z',
      },
    )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    const sourceRow = page.getByRole('row', { name: /Failed connected source/ })
    await sourceRow
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Failed connected source"}',
      })
      .click()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }))
      .not.toBeInTheDocument()
    await page.getByRole('menuitem', { name: 'common.operation.retry' }).click()

    await vi.waitFor(async () =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post,
      ).toHaveBeenCalledOnce(),
    )
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post,
    ).toHaveBeenCalledWith({
      params: { control_space_id: 'space-1', run_id: 'import-workflow' },
    })
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post,
    ).not.toHaveBeenCalled()
    await expect
      .element(sourceRow.getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
  })

  it('shows and polls an accepted async import even when the source status is briefly disabled', async () => {
    const pendingSource = source({
      metadata: {
        pendingImport: {
          kind: 'online-document-import',
          syncPolicy: { enabled: true, mode: 'interval' },
          workflowId: 'import-workflow',
        },
        preview: false,
      },
      name: 'Importing connected source',
      status: 'disabled',
    })
    sourceResponses.data = { pages: [{ items: [pendingSource] }] }

    const { queryClient } = await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const sourceRow = page.getByRole('row', { name: /Importing connected source/ })
    await expect
      .element(sourceRow.getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    expect(await measurePollIntervalFor(queryClient, [pendingSource])).toBe(3000)
  })

  it('keeps polling when the source list briefly returns the stale failed retry snapshot', async () => {
    const staleFailedWorkflow: SourceWorkflowRun = {
      ...sourceWorkflow('failed'),
      executionAttempts: 1,
      id: 'initial-workflow',
      lastErrorCode: 'SOURCE_WORKFLOW_FAILED',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    const staleFailedSource = source({
      metadata: {
        clientRequestId: 'initial-source:operation-1',
        initialImport: {
          state: 'failed',
          workflowId: 'initial-workflow',
        },
        preview: false,
      },
      name: 'Failed Initial Source',
      status: 'disabled',
      syncWorkflow: staleFailedWorkflow,
    })
    sourceResponses.data = { pages: [{ items: [staleFailedSource] }] }
    fake.console.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post.mockResolvedValue(
      {
        ...workflowResponse(),
        execution_attempts: 2,
        id: 'initial-workflow',
        updated_at: '2026-07-20T10:01:00Z',
      },
    )

    const view = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    const { queryClient } = view

    await page.getByRole('button', { name: 'common.operation.retry' }).click()
    await vi.waitFor(async () => {
      await expect
        .element(page.getByRole('status'))
        .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    })

    sourceResponses.data = { pages: [{ items: [staleFailedSource] }] }
    await view.refresh()

    await expect
      .element(page.getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
    expect(await measurePollIntervalFor(queryClient, [staleFailedSource])).toBe(3000)
  })
})
