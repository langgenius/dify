import type { SourceApi } from './source-server'
import { page } from 'vite-plus/test/browser'
import { apiError } from '@/test/fake-api'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import { source } from './source-fixtures'
import { resetSourceServer, sourceResponses } from './source-server'

let fake: SourceApi
beforeEach(() => {
  fake = resetSourceServer()
})
afterEach(() => {
  clearSourceClients()
  vi.useRealTimers()
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

    const confirm = page.getByRole('button', { name: 'knowledgeSources.removeSource' })
    await expect.element(confirm).toBeVisible()
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete,
    ).not.toHaveBeenCalled()
    await confirm.click()
    await vi.waitFor(async () =>
      expect(
        fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete,
      ).toHaveBeenCalledWith({
        body: { expectedRevision: 3 },
        headers: { 'Idempotency-Key': expect.any(String) },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
        query: { documents: 'keep' },
      }),
    )
    await expect.element(page.getByText('Product documentation')).not.toBeInTheDocument()
  })

  it.each([
    [
      'access denied without structured details',
      apiError({
        status: 403,
        code: 'knowledge_fs_access_denied',
        message: 'Agent Knowledge Base operation is not allowed.',
      }),
      'Agent Knowledge Base operation is not allowed.',
    ],
    [
      'conflict without structured details',
      apiError({
        status: 409,
        code: 'knowledge_fs_conflict',
        message: 'Agent Knowledge Base operation conflicts with the current resource state.',
      }),
      'Agent Knowledge Base operation conflicts with the current resource state.',
    ],
  ])('keeps the removal confirmation open and reports %s', async (_scenario, error, message) => {
    sourceResponses.data = { pages: [{ items: [source({})] }] }
    fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete.mockRejectedValue(
      error,
    )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSources.removeSource' }).click()
    await page.getByRole('button', { name: 'knowledgeSources.removeSource' }).click()

    await expect.element(page.getByText(message, { exact: true })).toBeVisible()
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete,
    ).toHaveBeenCalled()
    await expect
      .element(page.getByRole('button', { name: 'knowledgeSources.removeSource' }))
      .toBeInTheDocument()
    await vi.waitFor(async () => expect(sourceResponses.refresh).toHaveBeenCalled())
  })
})
