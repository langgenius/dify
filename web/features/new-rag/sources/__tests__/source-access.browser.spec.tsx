import type { SourceApi } from './source-server'
import { page } from 'vite-plus/test/browser'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import { source } from './source-fixtures'
import { permissionState, resetSourceServer, settingsState, sourceResponses } from './source-server'

let fake: SourceApi
beforeEach(() => {
  fake = resetSourceServer()
})
afterEach(() => {
  clearSourceClients()
  vi.useRealTimers()
})

describe('Sources: source-access', () => {
  it('keeps empty-state shortcuts inert without add-source permission', async () => {
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
    permissionState.knowledgeSpacePermissionKeys = []
    sourceResponses.data = { pages: [{ items: [] }] }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await expect.element(page.getByRole('link')).not.toBeInTheDocument()
    await expect.element(page.getByText('knowledgeSources.sourcesEmptyTitle')).toBeVisible()
  })

  it('opens a source URI from the row action menu', async () => {
    sourceResponses.data = { pages: [{ items: [source({})] }] }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()

    const openSource = page.getByRole('menuitem', {
      name: 'knowledgeSpace.openSource',
    })
    await expect.element(openSource).toHaveAttribute('href', 'https://docs.example.com')
    await expect.element(openSource).toHaveAttribute('target', '_blank')
    await expect.element(openSource).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('opens an Amazon S3 source in the AWS console for read-only users', async () => {
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
    permissionState.knowledgeSpacePermissionKeys = []
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              type: 'object-storage',
              uri: 's3://private-bucket/Product%20documentation/文档',
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
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSpace.openSource' }))
      .toHaveAttribute(
        'href',
        'https://s3.console.aws.amazon.com/s3/buckets/private-bucket?prefix=Product+documentation%2F%E6%96%87%E6%A1%A3',
      )
  })

  it('uses knowledge-space document-write permission for every source mutation action', async () => {
    permissionState.workspacePermissionKeys = ['dataset.external.connect']
    permissionState.knowledgeSpacePermissionKeys = ['knowledge_space_document_write']
    sourceResponses.data = { pages: [{ items: [source({})] }] }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()

    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('menuitem', { name: 'common.operation.edit' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSpace.disableSource' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSources.removeSource' }))
      .toBeInTheDocument()
  })

  it('keeps read-only source viewing while hiding mutation and add-source actions', async () => {
    permissionState.workspacePermissionKeys = ['dataset.acl.readonly']
    permissionState.knowledgeSpacePermissionKeys = []
    sourceResponses.data = { pages: [{ items: [source({ status: 'error' })] }] }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await expect
      .element(page.getByRole('link', { name: 'knowledgeSpace.addSource' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('button', { name: 'common.operation.retry' }))
      .not.toBeInTheDocument()
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSpace.openSource' }))
      .toBeInTheDocument()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSpace.disableSource' }))
      .not.toBeInTheDocument()
    await expect
      .element(page.getByRole('menuitem', { name: 'knowledgeSources.removeSource' }))
      .not.toBeInTheDocument()
  })

  it('prompts for model setup before syncing a source', async () => {
    settingsState.configurationState = 'setup-required'
    sourceResponses.data = { pages: [{ items: [source({})] }] }

    const { navigation } = await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'knowledgeSources.syncNow' }).click()

    const dialog = page.getByRole('dialog', {
      name: 'knowledgeSpace.overview.attention.modelReadiness.title',
    })
    await expect.element(dialog).toBeVisible()
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post,
    ).not.toHaveBeenCalled()
    await dialog
      .getByRole('button', {
        name: 'modelProvider.modelProvider.selector.configure',
      })
      .click()
    expect(navigation.router.push).toHaveBeenCalledWith(
      `/datasets/new/space-1/settings?returnTo=${encodeURIComponent(`/datasets/new/space-1/sources${window.location.search}`)}&capability=source_sync`,
    )
  })
})
