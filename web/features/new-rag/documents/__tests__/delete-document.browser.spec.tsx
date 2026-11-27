import {
  zKnowledgeFsDurableDeletionAcceptedResponse,
  zKnowledgeFsLogicalDocumentListResponse,
} from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { consoleQuery } from '@/service/console'
import { createMutationInvalidation } from '@/service/console/mutation-invalidation'
import { createConsoleQueryClient, createConsoleQueryWrapper } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { apiError, hold, installFakeApi } from '@/test/fake-api'
import { KnowledgeSpaceTestProvider } from '@/test/knowledge-space'
import { createTestNavigation } from '@/test/next-navigation'
import { QueryTestingAdapter } from '@/test/query-state-testing-adapter'
import { DocumentResultsSurface } from '../results/surface'
import { DocumentsStateBoundary } from '../state/boundary'

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
  const fake = installFakeApi({
    console: {
      knowledgeFs: {
        // The invalidation fallback refetches the knowledge features after the delete.
        features: { get: () => ({ agent_enabled: false, upload_enabled: true }) },
        spaces: {
          byControlSpaceId: {
            logicalDocuments: {
              get: () => ({ data: documents, next_cursor: null }),
              byDocumentId: {
                delete: async ({ params }) => {
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
                },
              },
            },
            sources: { get: () => ({ data: [], next_cursor: null }) },
            backgroundTasks: { get: () => ({ data: [], next_cursor: null }) },
            settings: {
              get: () => ({
                active_profile_available: true,
                active_profile_revisions: { embedding: 1, retrieval: 1 },
                capabilities: {
                  deep: true,
                  index: true,
                  ingest: true,
                  query: true,
                  research: true,
                  source_sync: true,
                },
                configuration_state: 'active',
                embedding: null,
                issues: [],
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
    // Like the app, refresh a mutation's domain after it succeeds.
    queryClient: createConsoleQueryClient({ invalidation: createMutationInvalidation() }),
    systemFeatures: { deployment_edition: 'ENTERPRISE' },
    features: { enable_knowledge_fs: true },
    knowledgeFsFeatures: { upload_enabled: true },
  })
  const { NavigationProvider } = createTestNavigation({ url: '/datasets/new/space-1/documents' })
  const screen = await render(
    <NavigationProvider>
      <QueryClientTestProvider queryClient={queryClient}>
        <QueryTestingAdapter>
          <KnowledgeSpaceTestProvider>
            <DocumentsStateBoundary knowledgeSpaceId="space-1">
              <DocumentResultsSurface />
              <AppToaster />
            </DocumentsStateBoundary>
          </KnowledgeSpaceTestProvider>
        </QueryTestingAdapter>
      </QueryClientTestProvider>
    </NavigationProvider>,
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
    remove: fake.console.knowledgeFs.spaces.byControlSpaceId.logicalDocuments.byDocumentId.delete,
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
    const { screen, open, remove, removeElsewhere } = await setup(['Alpha'])
    await open('Alpha')
    await removeElsewhere()
    await screen.getByRole('button', { name: 'common.operation.delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('region', { name: 'knowledgeSpace.documents', exact: true }))
      .toHaveFocus()
    expect(remove).not.toHaveBeenCalled()
  })

  it('uses the latest revision when the list refreshes with confirmation open', async () => {
    const { screen, open, remove, refreshRevision } = await setup(['Alpha'])
    await open('Alpha')
    await refreshRevision()
    await screen.getByRole('button', { name: 'common.operation.delete', exact: true }).click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ body: { expectedRevision: 2 } }))
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
    const { screen, open, remove } = await setup(['Alpha'])
    const request = hold(remove)
    await open('Alpha')
    const confirm = screen.getByRole('button', { name: 'common.operation.delete', exact: true })
    await confirm.click()
    await expect.element(confirm).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    request.reject(
      apiError({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Deletion service unavailable',
      }),
    )
    await expect
      .element(screen.getByText('Deletion service unavailable', { exact: true }))
      .toBeVisible()
    await confirm.click()
    await expect.element(screen.getByRole('alertdialog')).not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('region', { name: 'knowledgeSpace.documents', exact: true }))
      .toHaveFocus()
  })
})

it('returns focus to the row menu button after cancelling a rename', async () => {
  const { screen, actions } = await setup(['Alpha'])
  const trigger = actions('Alpha')
  await trigger.click()
  await screen.getByRole('menuitem', { name: 'common.operation.rename' }).click()
  const dialog = screen.getByRole('dialog', { name: 'common.operation.rename' })
  await expect.element(dialog.getByRole('textbox')).toHaveValue('Alpha')
  await expect.element(screen.getByRole('menu')).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(dialog).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})
