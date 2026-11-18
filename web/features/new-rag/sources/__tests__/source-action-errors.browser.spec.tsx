import { page } from 'vite-plus/test/browser'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import { source, sourceWorkflow } from './source-fixtures'
import { clientMock, resetSourceServer, sourceResponses } from './source-server'

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
      const mutation = action === 'retry' ? clientMock.retrySourceWorkflow : clientMock.syncSource
      mutation.mockRejectedValueOnce(
        Response.json(
          {
            failure: {
              action: 'retry',
              category,
              code,
              message: 'Upstream quota details',
              retryPolicy: 'manual',
            },
          },
          { status },
        ),
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
      expect(mutation).toHaveBeenCalledWith(expect.anything(), { context: { silent: true } })
    },
  )
})
