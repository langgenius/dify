import { zKnowledgeFsLogicalDocumentListResponse } from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { installFakeApi } from '@/test/fake-api'
import { createKnowledgeSpaceFixture } from '@/test/knowledge-space'
import { createTestNavigation } from '@/test/next-navigation'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { KnowledgeSpaceShell } from '../../space/shell'
import { DocumentResultsSurface } from '../results/surface'
import { DocumentsStateBoundary } from '../state/boundary'

// The unit renderer omits the shell's overflow boundary. This exercises the actual composed
// shell and results surfaces, including native keyboard scrolling and pagination hit testing.
it.each([
  { width: 1280, height: 720 },
  { width: 390, height: 700 },
])(
  'reaches lower documents and pagination inside the shell at $width px',
  async ({ width, height }) => {
    await page.viewport(width, height)
    const fake = installFakeApi({
      console: {
        knowledgeFs: {
          spaces: {
            byControlSpaceId: {
              get: () => createKnowledgeSpaceFixture(),
              externalAccess: {
                get: () => ({
                  revision: 1,
                  agent_enabled: true,
                  mcp_enabled: false,
                  service_api_enabled: false,
                  workflow_enabled: false,
                }),
              },
              logicalDocuments: {
                get: ({ query }) =>
                  zKnowledgeFsLogicalDocumentListResponse.parse({
                    data: Array.from({ length: query?.cursor ? 1 : 50 }, (_, index) => ({
                      id: query?.cursor ? 'last-document' : `document-${index}`,
                      title: query?.cursor ? 'Last document.pdf' : `Document ${index}.pdf`,
                      knowledge_space_id: 'space-1',
                      row_version: 1,
                      status: 'ready',
                      enabled: true,
                      active: null,
                      created_at: '2026-10-26T00:00:00Z',
                      updated_at: '2026-10-26T00:00:00Z',
                      user_metadata: {},
                    })),
                    next_cursor: query?.cursor ? null : 'next-matches',
                  }),
              },
              sources: { get: () => ({ data: [], next_cursor: null }) },
              backgroundTasks: { get: () => ({ data: [], next_cursor: null }) },
              settings: {
                get: () => ({
                  active_profile_available: false,
                  active_profile_revisions: { embedding: null, retrieval: null },
                  capabilities: {
                    deep: false,
                    index: false,
                    ingest: false,
                    query: false,
                    research: false,
                    source_sync: false,
                  },
                  configuration_state: 'validation-failed',
                  embedding: null,
                  issues: [{ code: 'validation_failed', field: 'embedding', retryable: true }],
                  retrieval: null,
                  revision: 1,
                }),
              },
            },
          },
        },
      },
    })
    onTestFinished(fake)
    const { queryClient } = createConsoleQueryWrapper({
      systemFeatures: { deployment_edition: 'ENTERPRISE' },
      features: { enable_knowledge_fs: true },
      knowledgeFsFeatures: { upload_enabled: true },
    })
    const { NavigationProvider } = createTestNavigation({
      url: '/datasets/new/space-1/documents',
    })
    const screen = await render(
      <NavigationProvider>
        <QueryClientTestProvider queryClient={queryClient}>
          <QueryTestingAdapter>
            <div className="flex h-dvh min-h-0 flex-col">
              <KnowledgeSpaceShell knowledgeSpaceId="space-1">
                <DocumentsStateBoundary knowledgeSpaceId="space-1">
                  <DocumentResultsSurface />
                </DocumentsStateBoundary>
              </KnowledgeSpaceShell>
            </div>
          </QueryTestingAdapter>
        </QueryClientTestProvider>
      </NavigationProvider>,
    )
    await expect.element(screen.getByText('common.api.actionFailed')).toBeInTheDocument()
    const loadMore = screen.getByRole('button', { name: 'knowledgeSpace.loadMore' })
    await expect.element(loadMore).toBeInTheDocument()
    const region = page
      .getByRole('region', { name: 'knowledgeSpace.documents', exact: true })
      .filter({ has: page.getByRole('button', { name: 'knowledgeSpace.loadMore' }) })
    const scroller = region.element() as HTMLElement
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    expect(getComputedStyle(scroller).overflowY).toBe('auto')
    await region.wheel({ delta: { y: 600, x: 0 } })
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
    scroller.focus()
    await userEvent.keyboard('{End}')
    await expect
      .poll(() => loadMore.element().getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(height)
    await loadMore.click()
    await expect
      .element(screen.getByRole('link', { name: 'Last document.pdf' }))
      .toBeInTheDocument()
    expect(
      fake.console.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ cursor: 'next-matches' }) }),
    )
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(height)
  },
)
