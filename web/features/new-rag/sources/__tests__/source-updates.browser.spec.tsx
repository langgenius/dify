import type { SourceSyncPolicy } from '../source-models'
import type { SourceApi } from './source-server'
import { page } from 'vite-plus/test/browser'
import { apiError } from '@/test/fake-api'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
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

describe('Sources: source-updates', () => {
  it('disables and re-enables a source through the real patch endpoint', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({ id: 'active-source', name: 'Active source' }),
            source({ id: 'disabled', name: 'Disabled source', status: 'disabled' }),
          ],
        },
      ],
    }

    fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch
      .mockResolvedValueOnce(
        sourceResponse(
          source({ id: 'active-source', name: 'Active source', status: 'disabled', version: 4 }),
        ),
      )
      .mockResolvedValueOnce(
        sourceResponse(
          source({ id: 'disabled', name: 'Disabled source', status: 'active', version: 4 }),
        ),
      )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    const activeSourceActions = page
      .getByRole('row', { name: /Active source/ })
      .getByRole('button', { name: /knowledgeSources.sourceActions/ })
    const disabledSourceActions = page
      .getByRole('row', { name: /Disabled source/ })
      .getByRole('button', { name: /knowledgeSources.sourceActions/ })
    await activeSourceActions.click()
    await page.getByRole('menuitem', { name: 'knowledgeSpace.disableSource' }).click()
    await vi.waitFor(async () =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch,
      ).toHaveBeenCalledWith({
        body: { expectedVersion: 3, status: 'disabled' },
        params: { control_space_id: 'space-1', source_id: 'active-source' },
      }),
    )

    await expect
      .element(page.getByRole('row', { name: /Active source/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.disabled')

    await disabledSourceActions.click()
    await page.getByRole('menuitem', { name: 'dataset.enable' }).click()
    await vi.waitFor(async () =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch,
      ).toHaveBeenLastCalledWith({
        body: { expectedVersion: 3, status: 'active' },
        params: { control_space_id: 'space-1', source_id: 'disabled' },
      }),
    )
    await expect
      .element(page.getByRole('row', { name: /Disabled source/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.active')
  })

  it('uses the returned source version while a workflow-enriched list replica is stale', async () => {
    const syncPolicy: SourceSyncPolicy = {
      createdAt: '2026-07-20T10:00:00Z',
      customIntervalSeconds: 86400,
      enabled: true,
      expectedSourceVersion: 3,
      id: 'policy-1',
      knowledgeSpaceId: 'space-1',
      mode: 'interval',
      revision: 1,
      sourceId: 'source-1',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    sourceResponses.data = {
      pages: [{ items: [source({ syncPolicy, syncWorkflow: sourceWorkflow('failed') })] }],
    }
    sourceResponses.refresh.mockRejectedValue(
      apiError({ status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Source refresh failed' }),
    )
    fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch
      .mockResolvedValueOnce(
        sourceResponse(
          source({
            status: 'disabled',
            updatedAt: '2026-07-20T10:01:00Z',
            version: 4,
          }),
        ),
      )
      .mockResolvedValueOnce(
        sourceResponse(
          source({
            status: 'active',
            updatedAt: '2026-07-20T10:02:00Z',
            version: 5,
          }),
        ),
      )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSpace.disableSource' }).click()

    await expect
      .element(page.getByRole('row', { name: /Product documentation/ }).getByRole('status'))
      .toMatchTextContent('knowledgeSpace.sourceStatus.disabled')
    await expect
      .element(
        page
          .getByRole('row', { name: /Product documentation/ })
          .getByText('knowledgeSources.syncPolicyDaily'),
      )
      .toBeInTheDocument()
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'dataset.enable' }).click()

    await vi.waitFor(async () =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch,
      ).toHaveBeenLastCalledWith({
        body: { expectedVersion: 4, status: 'active' },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })

  it('uses fresh list enrichment after an optimistic source update catches up', async () => {
    const dailyPolicy: SourceSyncPolicy = {
      createdAt: '2026-07-20T10:00:00Z',
      enabled: true,
      expectedSourceVersion: 3,
      id: 'policy-1',
      knowledgeSpaceId: 'space-1',
      mode: 'interval',
      revision: 1,
      sourceId: 'source-1',
      updatedAt: '2026-07-20T10:00:00Z',
    }
    const updatedSource = source({
      status: 'disabled',
      updatedAt: '2026-07-20T10:01:00Z',
      version: 4,
    })
    sourceResponses.data = { pages: [{ items: [source({ syncPolicy: dailyPolicy })] }] }
    fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch.mockResolvedValue(
      sourceResponse(updatedSource),
    )

    const view = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSpace.disableSource' }).click()
    await expect
      .element(
        page
          .getByRole('row', { name: /Product documentation/ })
          .getByText('knowledgeSources.syncPolicyDaily'),
      )
      .toBeInTheDocument()

    sourceResponses.data = {
      pages: [
        {
          items: [
            {
              ...updatedSource,
              lastSyncedAt: '2026-07-20T10:02:00Z',
              syncPolicy: {
                ...dailyPolicy,
                enabled: false,
                expectedSourceVersion: 4,
                mode: 'manual',
                revision: 2,
                updatedAt: '2026-07-20T10:02:00Z',
              },
            },
          ],
        },
      ],
    }
    await view.refresh()

    const row = page.getByRole('row', { name: /Product documentation/ })
    await expect.element(row.getByText('knowledgeSources.syncPolicyManual')).toBeInTheDocument()
    await expect.element(row.getByText('knowledgeSources.syncPolicyDaily')).not.toBeInTheDocument()
    await expect.element(row.getByText('—')).not.toBeInTheDocument()
  })
})
