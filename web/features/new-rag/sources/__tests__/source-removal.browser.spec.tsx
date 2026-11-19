import { ORPCError } from '@orpc/client'
import { page } from 'vite-plus/test/browser'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import { source } from './source-fixtures'
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

describe('Source removal confirmation', () => {
  it('requires confirmation before removing a source', async () => {
    sourceResponses.data = { pages: [{ items: [source({})] }] }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSources.removeSource' }).click()

    expect(clientMock.deleteSource).not.toHaveBeenCalled()
    await page.getByRole('button', { name: 'knowledgeSources.removeSource' }).click()
    await vi.waitFor(async () =>
      expect(clientMock.deleteSource).toHaveBeenCalledWith(
        {
          body: { expectedRevision: 3 },
          headers: { 'Idempotency-Key': expect.any(String) },
          params: { control_space_id: 'space-1', source_id: 'source-1' },
          query: { documents: 'keep' },
        },
        { context: { silent: true } },
      ),
    )
    await expect.element(page.getByText('Product documentation')).not.toBeInTheDocument()
  })

  it.each([
    [
      'access denied without structured details',
      new ORPCError('knowledge_fs_access_denied', {
        status: 403,
        message: 'Agent Knowledge Base operation is not allowed.',
      }),
      'Agent Knowledge Base operation is not allowed.',
    ],
    [
      'conflict without structured details',
      new ORPCError('knowledge_fs_conflict', {
        status: 409,
        message: 'Agent Knowledge Base operation conflicts with the current resource state.',
      }),
      'Agent Knowledge Base operation conflicts with the current resource state.',
    ],
    // oxlint-disable-next-line unicorn/error-message -- Verify the generic fallback for an error without a message.
    ['missing error message', new Error(''), 'knowledgeSpace.sourcesErrorDescription'],
  ])('keeps the removal confirmation open and reports %s', async (_scenario, error, message) => {
    sourceResponses.data = { pages: [{ items: [source({})] }] }
    clientMock.deleteSource.mockRejectedValue(error)

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSources.removeSource' }).click()
    await page.getByRole('button', { name: 'knowledgeSources.removeSource' }).click()

    await expect.element(page.getByText(message, { exact: true })).toBeVisible()
    expect(clientMock.deleteSource).toHaveBeenCalledWith(expect.anything(), {
      context: { silent: true },
    })
    await expect
      .element(page.getByRole('button', { name: 'knowledgeSources.removeSource' }))
      .toBeInTheDocument()
    await vi.waitFor(async () => expect(sourceResponses.refresh).toHaveBeenCalled())
  })
})
