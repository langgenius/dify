import type { SourceApi } from './source-server'
import { page } from 'vite-plus/test/browser'
import { apiError } from '@/test/fake-api'
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

describe('Source sync quota failures', () => {
  it.each([
    ['sync', 'DOCUMENT_COUNT_QUOTA_EXCEEDED', 'configuration', 413, 'documentCountQuotaExceeded'],
    [
      'retry',
      'DOCUMENT_COUNT_QUOTA_UNAVAILABLE',
      'dependency',
      503,
      'documentCountQuotaUnavailable',
    ],
  ] as const)(
    'shows the quota error when a source %s is rejected',
    async (action, code, category, status, messageKey) => {
      sourceResponses.data = {
        pages: [
          {
            items: [
              source({
                status: action === 'retry' ? 'error' : 'active',
                syncWorkflow: action === 'retry' ? sourceWorkflow('failed') : undefined,
              }),
            ],
          },
        ],
      }
      const mutation =
        action === 'retry'
          ? fake.console.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post
          : fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post
      mutation.mockRejectedValueOnce(
        apiError({
          status,
          code,
          message: 'Upstream quota details',
          details: {
            failure: {
              action: 'retry',
              category,
              code,
              message: 'Upstream quota details',
              retryPolicy: 'manual',
            },
          },
        }),
      )

      await render(<SourcesPage knowledgeSpaceId="space-1" />)
      if (action === 'retry') {
        await page.getByRole('button', { name: 'common.operation.retry' }).click()
      } else {
        await page
          .getByRole('button', {
            name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
          })
          .click()
        await page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }).click()
      }

      await expect
        .element(page.getByText(`knowledgeErrors.taskFailure.${messageKey}`, { exact: true }))
        .toBeVisible()
      await expect
        .element(page.getByRole('status'))
        .not.toMatchTextContent('knowledgeSpace.sourceStatus.syncing')
      expect(mutation).toHaveBeenCalled()
    },
  )
})
