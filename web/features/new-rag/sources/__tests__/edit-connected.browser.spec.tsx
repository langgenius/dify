import { page, userEvent } from 'vite-plus/test/browser'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import {
  googleDriveDatasourcePlugin,
  notionDatasourcePlugin,
  source,
  sourceWorkflow,
} from './source-fixtures'
import {
  clientMock,
  pluginResponses,
  resetSourceServer,
  serveDriveConnection,
  serveNotionConnection,
  sourceResponses,
} from './source-server'

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

describe('Sources: edit-connected', () => {
  it('submits an online document selection in the source PATCH', async () => {
    pluginResponses.data = [notionDatasourcePlugin]
    serveNotionConnection()
    clientMock.previewConnectedSource.mockResolvedValue({
      documents: [
        {
          last_edited_time: '2026-08-30T10:00:00Z',
          name: 'Product plan',
          page_id: 'page-1',
          provider_item_id: 'opaque-provider-page-1',
          type: 'page',
          workspace_id: 'workspace-1',
          workspace_name: 'Product',
        },
      ],
      next_page_parameters: null,
    })
    const connectorSource = source({
      connectionId: 'connection-notion',
      metadata: {
        parameters: { workspace: 'product' },
        providerId: 'plugin-daemon-online-document',
        providerKind: 'online-document',
        providerName: 'Notion',
      },
      type: 'connector',
      uri: 'notion://connection-notion',
    })
    sourceResponses.data = { pages: [{ items: [connectorSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({
        ...connectorSource,
        status: 'syncing',
        syncWorkflow: sourceWorkflow(),
        version: 4,
      }),
    )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await page.getByRole('checkbox', { name: 'Product plan' }).click()
    await page.getByRole('button', { name: 'common.operation.save' }).click()

    await vi.waitFor(async () =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Product documentation',
          providerParameters: { workspace: 'product' },
          selection: {
            items: [
              {
                lastEditedTime: '2026-08-30T10:00:00Z',
                name: 'Product plan',
                pageId: 'page-1',
                providerItemId: 'opaque-provider-page-1',
                type: 'page',
                workspaceId: 'workspace-1',
              },
            ],
            kind: 'online_document',
          },
          syncPolicy: { enabled: false, mode: 'manual' },
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
    expect(clientMock.previewConnectedSource).toHaveBeenCalledWith({
      body: {
        credentialId: 'credential-notion',
        datasource: 'notion',
        kind: 'online_document',
        parameters: { workspace: 'product' },
        pluginId: 'langgenius/notion_datasource',
        provider: 'notion_datasource',
      },
    })
  })

  it('submits an online drive selection with the provider resource identity', async () => {
    pluginResponses.data = [googleDriveDatasourcePlugin]
    serveDriveConnection()
    clientMock.previewConnectedSource.mockResolvedValue({
      files: [
        {
          bucket: 'project-files',
          id: 'file-1',
          mime_type: 'application/pdf',
          name: 'Project plan.pdf',
          provider_item_id: 'opaque-provider-file-1',
          size: 1024,
          type: 'application/pdf',
        },
      ],
      next_page_parameters: null,
    })
    const connectorSource = source({
      connectionId: 'connection-drive',
      metadata: {
        parameters: { folder: 'project-a' },
        providerId: 'plugin-daemon-online-drive',
        providerKind: 'online-drive',
        providerName: 'Google Drive',
      },
      type: 'connector',
      uri: 'gdrive://connection-drive',
    })
    sourceResponses.data = { pages: [{ items: [connectorSource] }] }
    clientMock.patchSource.mockResolvedValue(
      source({ ...connectorSource, status: 'syncing', syncWorkflow: sourceWorkflow(), version: 4 }),
    )

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await page.getByRole('checkbox', { name: 'Project plan.pdf' }).click()
    await page.getByRole('button', { name: 'common.operation.save' }).click()

    await vi.waitFor(async () =>
      expect(clientMock.patchSource).toHaveBeenCalledWith({
        body: {
          expectedVersion: 3,
          name: 'Product documentation',
          providerParameters: { folder: 'project-a' },
          selection: {
            items: [
              {
                bucket: 'project-files',
                id: 'file-1',
                mimeType: 'application/pdf',
                name: 'Project plan.pdf',
                providerItemId: 'opaque-provider-file-1',
              },
            ],
            kind: 'online_drive',
          },
          syncPolicy: { enabled: false, mode: 'manual' },
        },
        params: { control_space_id: 'space-1', source_id: 'source-1' },
      }),
    )
  })

  it('discards pending connected-source pagination after the parameters change', async () => {
    pluginResponses.data = [notionDatasourcePlugin]
    serveNotionConnection()
    const notionDocument = (id: string, name: string, workspaceId: string) => ({
      last_edited_time: '2026-08-30T10:00:00Z',
      name,
      page_id: id,
      provider_item_id: `opaque-${id}`,
      type: 'page',
      workspace_id: workspaceId,
      workspace_name: workspaceId,
    })
    let resolveStalePage: (value: unknown) => void = () => {}
    clientMock.previewConnectedSource
      .mockResolvedValueOnce({
        documents: [notionDocument('old-1', 'Old plan', 'workspace-old')],
        next_page_parameters: { cursor: 'page-2' },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStalePage = resolve
          }),
      )
      .mockResolvedValueOnce({
        documents: [notionDocument('new-1', 'New plan', 'workspace-new')],
        next_page_parameters: null,
      })
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              connectionId: 'connection-notion',
              metadata: {
                parameters: { workspace: 'old' },
                providerId: 'plugin-daemon-online-document',
                providerKind: 'online-document',
                providerName: 'Notion',
              },
              type: 'connector',
              uri: 'notion://connection-notion',
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
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await page.getByRole('button', { name: 'knowledgeSpace.loadMore' }).click()
    const workspace = page.getByRole('textbox', { name: /Workspace/ })
    await workspace.fill('new')
    resolveStalePage({
      documents: [notionDocument('old-2', 'Stale plan', 'workspace-old')],
      next_page_parameters: null,
    })

    await expect.element(page.getByRole('checkbox', { name: 'Stale plan' })).not.toBeInTheDocument()
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await expect.element(page.getByRole('checkbox', { name: 'New plan' })).toBeInTheDocument()
    await expect.element(page.getByRole('checkbox', { name: 'Stale plan' })).not.toBeInTheDocument()
    await expect.element(page.getByRole('checkbox', { name: 'Old plan' })).not.toBeInTheDocument()
  })

  it('submits the connected-source editor from its form boundary', async () => {
    pluginResponses.data = [notionDatasourcePlugin]
    serveNotionConnection()
    clientMock.previewConnectedSource.mockResolvedValue({
      documents: [
        {
          last_edited_time: '2026-08-30T10:00:00Z',
          name: 'Product plan',
          page_id: 'page-1',
          provider_item_id: 'opaque-provider-page-1',
          type: 'page',
          workspace_id: 'workspace-1',
          workspace_name: 'Product',
        },
      ],
      next_page_parameters: null,
    })
    const connectorSource = source({
      connectionId: 'connection-notion',
      metadata: {
        parameters: { workspace: 'product' },
        providerId: 'plugin-daemon-online-document',
        providerKind: 'online-document',
        providerName: 'Notion',
      },
      type: 'connector',
      uri: 'notion://connection-notion',
    })
    sourceResponses.data = { pages: [{ items: [connectorSource] }] }
    clientMock.patchSource.mockResolvedValue(source({ ...connectorSource, version: 4 }))

    await render(<SourcesPage knowledgeSpaceId="space-1" />)
    await page
      .getByRole('button', {
        name: 'knowledgeSources.sourceActions:{"name":"Product documentation"}',
      })
      .click()
    await page.getByRole('menuitem', { name: 'common.operation.edit' }).click()
    await page.getByRole('button', { name: 'knowledgeSpace.preview' }).click()
    await page.getByRole('checkbox', { name: 'Product plan' }).click()

    await page.getByRole('textbox', { name: /knowledgeSources.sourceName/ }).click()
    await userEvent.keyboard('{Enter}')

    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument()
    await vi.waitFor(() =>
      expect(clientMock.patchSource).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            selection: expect.objectContaining({ kind: 'online_document' }),
          }),
        }),
      ),
    )
  })
})
