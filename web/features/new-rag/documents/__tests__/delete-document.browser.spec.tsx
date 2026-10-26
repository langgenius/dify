import type { consoleClient } from '@/service/console'
import {
  zKnowledgeFsDurableDeletionAcceptedResponse,
  zKnowledgeFsLogicalDocumentListResponse,
} from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createDeferred } from '@/test/deferred'
import { KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { DocumentResultsSurface } from '../results/surface'
import { DocumentsStateBoundary } from '../state/boundary'

vi.mock('../../components/knowledge-model-readiness-banner', () => ({
  KnowledgeModelReadinessBanner: () => null,
}))
const api = vi.hoisted(() => ({
  list: vi.fn<typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get>(),
  remove:
    vi.fn<
      typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.delete
    >(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get': api.list,
      'knowledgeFs.spaces.byControlSpaceId.sources.get': async () => ({
        data: [],
        next_cursor: null,
      }),
      'knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get': async () => ({
        data: [],
        next_cursor: null,
      }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.delete': api.remove,
    }),
  }
})
beforeEach(() => vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false))
afterEach(() => vi.unstubAllGlobals())
async function setup(ids: string[]) {
  let documents = zKnowledgeFsLogicalDocumentListResponse.parse({
    data: ids.map((id) => ({
      id,
      title: id,
      knowledge_space_id: 'space-1',
      row_version: 1,
      status: 'ready',
      enabled: true,
      active: null,
      created_at: '2026-07-20T10:00:00Z',
      updated_at: '2026-07-20T10:00:00Z',
      user_metadata: {},
    })),
    next_cursor: null,
  }).data
  api.list.mockReset().mockImplementation(async () => ({ data: documents, next_cursor: null }))
  api.remove.mockReset().mockImplementation(async ({ params }) => {
    documents = documents.filter((item) => item.id !== params.document_id)
    return zKnowledgeFsDurableDeletionAcceptedResponse.parse({
      status_url: '/deletion',
      job: {
        id: 'delete-1',
        checkpoint: 'requested',
        created_at: '2026-07-20T10:00:00Z',
        updated_at: '2026-07-20T10:00:00Z',
        knowledge_space_id: 'space-1',
        target_id: params.document_id,
        target_type: 'logical_document',
        run_state: 'queued',
      },
    })
  })
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: 'ENTERPRISE' },
    knowledgeFsFeatures: { enabled: true, upload_enabled: true },
  })
  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <QueryTestingAdapter>
        <KnowledgeSpaceTestProvider>
          <DocumentsStateBoundary knowledgeSpaceId="space-1">
            <DocumentResultsSurface />
            <AppToaster />
          </DocumentsStateBoundary>
        </KnowledgeSpaceTestProvider>
      </QueryTestingAdapter>
    </QueryClientTestProvider>,
  )
  const actions = (id: string) =>
    screen.getByRole('button', { name: `knowledgeDocuments.documentActions:{"name":"${id}"}` })
  const open = async (id: string) => {
    await actions(id).click()
    await screen.getByRole('menuitem', { name: 'common.operation.delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  }
  return {
    screen,
    open,
    actions,
    removeElsewhere: async () => {
      documents = []
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
      })
    },
    refreshRevision: async () => {
      documents = documents.map((document) => ({ ...document, row_version: 2 }))
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.get.key(),
      })
    },
  }
}
describe('Knowledge document deletion', () => {
  it('closes safely if the document was removed elsewhere while confirmation was open', async () => {
    const { screen, open, removeElsewhere } = await setup(['Alpha'])
    await open('Alpha')
    await removeElsewhere()
    await screen.getByRole('button', { name: 'common.operation.delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('region', { name: 'knowledgeSpace.documents', exact: true }))
      .toHaveFocus()
    expect(api.remove).not.toHaveBeenCalled()
  })

  it('uses the latest revision when the list refreshes with confirmation open', async () => {
    const { screen, open, refreshRevision } = await setup(['Alpha'])
    await open('Alpha')
    await refreshRevision()
    await screen.getByRole('button', { name: 'common.operation.delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    expect(api.remove).toHaveBeenCalledWith(
      expect.objectContaining({ body: { expectedRevision: 2 } }),
    )
  })

  it.each([
    { ids: ['Alpha', 'Beta', 'Gamma'], remove: 'Beta', next: 'Gamma' },
    { ids: ['Alpha', 'Beta'], remove: 'Beta', next: 'Alpha' },
    { ids: ['Alpha'], remove: 'Alpha', next: null },
  ])('restores focus after deleting $remove from $ids', async ({ ids, remove, next }) => {
    const { screen, open, actions } = await setup(ids)
    await open(remove)
    await screen.getByRole('button', { name: 'common.operation.delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect.element(actions(remove)).not.toBeInTheDocument()
    await expect
      .element(
        next
          ? screen.getByRole('link', { name: next, exact: true })
          : screen.getByRole('region', { name: 'knowledgeSpace.documents', exact: true }),
      )
      .toHaveFocus()
  })
  it('holds focus and prevents dismissal while deletion is pending', async () => {
    const { screen, open } = await setup(['Alpha'])
    const request =
      createDeferred<
        Awaited<
          ReturnType<
            typeof consoleClient.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.delete
          >
        >
      >()
    api.remove.mockReturnValueOnce(request.promise)
    await open('Alpha')
    const confirm = screen.getByRole('button', { name: 'common.operation.delete', exact: true })
    await confirm.click()
    await expect.element(confirm).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    request.reject(new Error('Failed'))
    await expect
      .element(screen.getByText('knowledgeSpace.documentsErrorDescription', { exact: true }))
      .toBeVisible()
    await confirm.click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('region', { name: 'knowledgeSpace.documents', exact: true }))
      .toHaveFocus()
  })
})
