import type { SourceSyncPolicy } from '../source-models'
import { page } from 'vite-plus/test/browser'
import { SourcesPage } from '../page'
import { clearSourceClients, renderSources as render } from './source-browser-env'
import { source } from './source-fixtures'
import { resetSourceServer, sourceResponses } from './source-server'

beforeEach(() => {
  resetSourceServer()
})
afterEach(() => {
  clearSourceClients()
  vi.useRealTimers()
})

describe('Sources: provider-details', () => {
  it('shows provider and source type as separate row details', async () => {
    sourceResponses.data = {
      pages: [{ items: [source({ metadata: { providerName: 'Firecrawl' } })] }],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    await expect.element(page.getByText('Firecrawl')).toBeInTheDocument()
    await expect.element(page.getByText('knowledgeSpace.sourceType.web')).toBeInTheDocument()
  })

  it('restores legacy website provider metadata and shows policy and last sync details', async () => {
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
      pages: [
        {
          items: [
            source({
              lastSyncedAt: '2026-07-20T10:00:00Z',
              metadata: {
                preview: false,
                providerId: 'plugin-daemon-website-firecrawl',
              },
              syncPolicy,
            }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = page.getByRole('row', { name: /Product documentation/ })
    await expect.element(row.getByText('Firecrawl')).toBeInTheDocument()
    await expect.element(row.getByText('knowledgeSources.syncPolicyDaily')).toBeInTheDocument()
    await expect.element(row.getByText('—')).not.toBeInTheDocument()
  })

  it('restores a legacy Notion provider identifier as the designed provider details', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              metadata: { providerName: 'notion_datasource' },
              name: 'Notion support SOP',
              type: 'connector',
            }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = page.getByRole('row', { name: /Notion support SOP/ })
    await expect.element(row.getByText('Notion')).toBeInTheDocument()
    await expect.element(row.getByText('knowledgeSpace.onlineDocuments')).toBeInTheDocument()
    await expect.element(row.getByText('notion_datasource')).not.toBeInTheDocument()
  })

  it('preserves a custom provider name containing a built-in brand', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                providerKind: 'online-document',
                providerName: 'Notion Backup',
              },
              name: 'Archived workspace',
              type: 'connector',
            }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = page.getByRole('row', { name: /Archived workspace/ })
    await expect.element(row.getByText('Notion Backup')).toBeInTheDocument()
    await expect.element(row.getByText('Notion')).not.toBeInTheDocument()
  })

  it('uses provider kind to distinguish legacy Google Drive sources', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              metadata: {
                providerKind: 'online-drive',
                providerName: 'google_drive',
              },
              name: 'Escalation archive',
              type: 'connector',
            }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = page.getByRole('row', { name: /Escalation archive/ })
    await expect.element(row.getByText('Google Drive')).toBeInTheDocument()
    await expect.element(row.getByText('knowledgeSpace.onlineDrive')).toBeInTheDocument()
  })

  it('identifies a legacy OneDrive source by its provider and type', async () => {
    sourceResponses.data = {
      pages: [
        {
          items: [
            source({
              metadata: { providerName: 'microsoft_onedrive' },
              name: 'Sales enablement',
              type: 'connector',
            }),
          ],
        },
      ],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = page.getByRole('row', { name: /Sales enablement/ })
    await expect.element(row.getByText('OneDrive')).toBeInTheDocument()
    await expect.element(row.getByText('knowledgeSpace.onlineDrive')).toBeInTheDocument()
  })

  it('does not report ordinary source updates as successful syncs', async () => {
    const syncPolicy: SourceSyncPolicy = {
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
    sourceResponses.data = {
      pages: [{ items: [source({ metadata: { preview: false }, syncPolicy })] }],
    }

    await render(<SourcesPage knowledgeSpaceId="space-1" />)

    const row = page.getByRole('row', { name: /Product documentation/ })
    await expect.element(row.getByText('—')).toBeInTheDocument()
  })
})
