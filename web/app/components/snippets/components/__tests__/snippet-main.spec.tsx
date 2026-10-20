import type { Node } from '@/app/components/workflow/types'
import type { SnippetDetailPayload } from '@/models/snippet'
import { ORPCError } from '@orpc/client'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import WorkflowWithDefaultContext from '@/app/components/workflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import codeNodeDefault from '@/app/components/workflow/nodes/code/default'
import { toast } from '@/app/notifications'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { PipelineInputVarType } from '@/models/pipeline'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createDeferred } from '@/test/deferred'
import { createWorkflowResponseFixture } from '@/test/fixtures/workflow-response'
import { useSnippetDraftStore } from '../../draft-store'
import { useSnippetDetailStore } from '../../store'
import { SnippetDetailSection } from '../snippet-detail-section'
import SnippetMain from '../snippet-main'

const api = vi.hoisted(() => ({
  save: vi.fn<
    typeof import('@/service/console').consoleClient.snippets.bySnippetId.workflows.draft.post
  >(),
  publish:
    vi.fn<
      typeof import('@/service/console').consoleClient.snippets.bySnippetId.workflows.publish.post
    >(),
  refresh:
    vi.fn<
      typeof import('@/service/console').consoleClient.snippets.bySnippetId.workflows.draft.get
    >(),
  close: vi.fn<typeof import('@/service/fetch').postWithKeepalive>(),
}))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ snippetId: 'snippet-1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/snippets/snippet-1/orchestrate',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/service/fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/fetch')>()),
  postWithKeepalive: api.close,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'snippets.bySnippetId.workflows.draft.post': api.save,
      'snippets.bySnippetId.workflows.publish.post': api.publish,
      'snippets.bySnippetId.workflows.draft.get': api.refresh,
      'snippets.bySnippetId.workflows.draft.variables.get': async () => ({ items: [], total: 0 }),
    }),
  }
})

const draftNode = (title = 'Draft transform') =>
  createNode({
    id: 'code',
    width: 240,
    height: 120,
    data: {
      ...codeNodeDefault.defaultValue,
      title,
      code: 'def main():\n    return {"result": "ok"}',
    },
  })
const fields = [
  { type: PipelineInputVarType.textInput, label: 'Blog URL', variable: 'blog_url', required: true },
]
const payload: SnippetDetailPayload = {
  snippet: {
    id: 'snippet-1',
    name: 'Snippet',
    description: 'Transform text',
    updatedAt: '2026-03-29 10:00',
    usage: '0',
    tags: [],
  },
  graph: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  inputFields: fields,
  uiMeta: { inputFieldCount: 1, checklistCount: 0, autoSavedAt: '2026-03-29 10:00' },
}

beforeEach(() => {
  api.save.mockReset().mockResolvedValue({ result: 'success', hash: 'saved-hash', updated_at: 2 })
  api.publish.mockReset().mockResolvedValue({ result: 'success', created_at: 1744000000 })
  api.refresh.mockReset().mockResolvedValue({
    ...createWorkflowResponseFixture(),
    id: 'draft-1',
    features: {},
    created_at: 1,
    graph: { nodes: [draftNode()], edges: [] },
    input_fields: fields,
    hash: 'refreshed',
    updated_at: 3,
  })
  api.close.mockReset()
  useSnippetDraftStore.getState().reset()
  useSnippetDetailStore.getState().reset()
})
afterEach(async () => {
  await act(async () => cleanup())
  vi.restoreAllMocks()
})

function renderSnippet({
  canEdit = true,
  nodes = [draftNode()],
  published = false,
}: { canEdit?: boolean; nodes?: Node[]; published?: boolean } = {}) {
  const { queryClient } = createConsoleQueryWrapper({
    systemFeatures: { enable_collaboration_mode: false, enable_marketplace: false },
    workspacePermissionKeys: canEdit ? ['snippets.create_and_modify'] : ['snippets.management'],
  })
  seedAppDslVersion(queryClient)
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  const publishedNodes = published ? [draftNode('Published transform')] : []
  return renderWorkflowComponent(
    <NuqsTestingAdapter>
      <EventEmitterContextProvider>
        <WorkflowWithDefaultContext nodes={nodes} edges={[]}>
          <aside aria-label="Snippet settings">
            <SnippetDetailSection expand />
          </aside>
          <SnippetMain
            payload={payload}
            draftPayload={payload}
            hasInitialDraftChanges
            hasPublishedWorkflow={published}
            nodes={publishedNodes}
            edges={[]}
            draftNodes={nodes}
            draftEdges={[]}
          />
        </WorkflowWithDefaultContext>
      </EventEmitterContextProvider>
    </NuqsTestingAdapter>,
    {
      queryClient,
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
      initialStoreState: { isWorkflowDataLoaded: true },
    },
  )
}

const sidebar = () => within(screen.getByRole('complementary', { name: 'Snippet settings' }))
const publishButton = () => screen.getByRole('button', { name: 'snippet.publishButton' })

it.each([true, false])(
  'respects edit permission in the canvas, sidebar and save-on-exit: %s',
  async (canEdit) => {
    const { unmount } = renderSnippet({ canEdit })
    expect(screen.getByText('Draft transform')).toBeInTheDocument()
    expect(sidebar().getByRole('link', { name: 'snippet.sectionOrchestrate' })).toHaveAttribute(
      'href',
      '/snippets/snippet-1/orchestrate',
    )
    if (canEdit) {
      expect(publishButton()).toBeEnabled()
      expect(
        sidebar().getByRole('button', { name: 'common.operation.add snippet.inputVariables' }),
      ).toBeEnabled()
    } else {
      expect(
        screen.queryByRole('button', { name: 'snippet.publishButton' }),
      ).not.toBeInTheDocument()
      expect(
        sidebar().queryByRole('button', { name: 'common.operation.add snippet.inputVariables' }),
      ).not.toBeInTheDocument()
    }
    act(() => window.dispatchEvent(new Event('beforeunload')))
    if (canEdit)
      expect(api.close).toHaveBeenCalledWith(
        expect.stringContaining('/snippets/snippet-1/workflows/draft'),
        expect.objectContaining({ input_fields: fields }),
      )
    else expect(api.close).not.toHaveBeenCalled()
    await act(async () => unmount())
    if (canEdit)
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { snippet_id: 'snippet-1' },
          body: expect.objectContaining({
            graph: expect.objectContaining({ nodes: [expect.objectContaining({ id: 'code' })] }),
          }),
        }),
      )
    else expect(api.save).not.toHaveBeenCalled()
  },
)

it('edits the draft graph when a published version exists', () => {
  renderSnippet({ published: true })
  expect(screen.getByText('Draft transform')).toBeInTheDocument()
  expect(screen.queryByText('Published transform')).not.toBeInTheDocument()
  expect(publishButton()).toBeEnabled()
})

it('keeps publishing disabled for an empty graph', async () => {
  const user = userEvent.setup()
  renderSnippet({ nodes: [] })
  expect(publishButton()).toBeDisabled()
  await user.click(publishButton())
  expect(api.save).not.toHaveBeenCalled()
  expect(api.publish).not.toHaveBeenCalled()
})

it('waits for the latest graph and fields to save before publishing', async () => {
  const user = userEvent.setup()
  const saved = createDeferred<Awaited<ReturnType<typeof api.save>>>()
  api.save.mockReturnValueOnce(saved.promise)
  renderSnippet()
  await user.click(publishButton())
  await waitFor(() => expect(api.save).toHaveBeenCalled())
  expect(api.save.mock.lastCall?.[0].body).toMatchObject({
    graph: { nodes: [{ data: { title: 'Draft transform' } }] },
    input_fields: fields,
  })
  expect(api.publish).not.toHaveBeenCalled()
  await act(async () => saved.resolve({ result: 'success', hash: 'latest', updated_at: 3 }))
  await waitFor(() =>
    expect(api.publish).toHaveBeenCalledExactlyOnceWith({
      params: { snippet_id: 'snippet-1' },
      body: {},
    }),
  )
  expect(screen.getByText('Draft transform')).toBeInTheDocument()
})

it('does not publish when saving the latest draft fails and can retry', async () => {
  const user = userEvent.setup()
  api.save.mockRejectedValueOnce(new Error('Save unavailable'))
  renderSnippet()
  await user.click(publishButton())
  await waitFor(() => expect(api.save).toHaveBeenCalledOnce())
  expect(api.publish).not.toHaveBeenCalled()
  await user.click(publishButton())
  await waitFor(() => expect(api.publish).toHaveBeenCalledOnce())
})

it('offers only supported snippet blocks through the real selector', async () => {
  const user = userEvent.setup()
  renderSnippet({ nodes: [] })
  await user.click(screen.getByRole('button', { name: 'workflow.common.addBlock' }))
  expect(await screen.findByRole('button', { name: 'workflow.blocks.llm' })).toBeInTheDocument()
  for (const name of [
    'workflow.blocks.human-input',
    'workflow.blocks.end',
    'workflow.blocks.knowledge-retrieval',
  ])
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
})

async function fillNewField(
  user: ReturnType<typeof userEvent.setup>,
  variable: string,
  label: string,
) {
  await user.click(
    sidebar().getByRole('button', { name: 'common.operation.add snippet.inputVariables' }),
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'appDebug.variableConfig.addModalTitle',
  })
  await user.type(
    within(dialog).getByRole('textbox', { name: 'appDebug.variableConfig.varName' }),
    variable,
  )
  const labelInput = within(dialog).getByRole('textbox', {
    name: 'appDebug.variableConfig.labelName',
  })
  await user.clear(labelInput)
  await user.type(labelInput, label)
  return within(dialog)
}

it('adds a field through the real sidebar form and persists it with the graph', async () => {
  const user = userEvent.setup()
  renderSnippet()
  const dialog = await fillNewField(user, 'question', 'Question')
  await user.click(dialog.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(sidebar().getByText('Question')).toBeInTheDocument()
  await waitFor(() => expect(api.save).toHaveBeenCalled())
  expect(api.save.mock.lastCall?.[0].body).toMatchObject({
    graph: { nodes: [{ id: 'code' }] },
    input_fields: [
      fields[0],
      { variable: 'question', label: 'Question', type: PipelineInputVarType.textInput },
    ],
  })
})

it('removes a field through its actual row and saves the empty field list', async () => {
  const user = userEvent.setup()
  renderSnippet()
  await user.hover(sidebar().getByText('Blog URL'))
  await user.click(sidebar().getByRole('button', { name: 'common.operation.remove' }))
  expect(sidebar().queryByText('Blog URL')).not.toBeInTheDocument()
  await waitFor(() => expect(api.save).toHaveBeenCalled())
  expect(api.save.mock.lastCall?.[0].body.input_fields).toEqual([])
})

it('restores authoritative fields after a draft conflict', async () => {
  const user = userEvent.setup()
  api.save.mockRejectedValueOnce(
    new ORPCError('draft_workflow_not_sync', {
      defined: true,
      status: 409,
      message: 'Draft changed',
      data: { code: 'draft_workflow_not_sync', status: 409, message: 'Draft changed' },
    }),
  )
  renderSnippet()
  await user.hover(sidebar().getByText('Blog URL'))
  await user.click(sidebar().getByRole('button', { name: 'common.operation.remove' }))
  await waitFor(() => expect(api.refresh).toHaveBeenCalledOnce())
  expect(await sidebar().findByText('Blog URL')).toBeInTheDocument()
})

it.each([
  { variable: 'blog_url', label: 'Other label', field: 'variable' },
  { variable: 'other_url', label: 'Blog URL', field: 'label' },
])(
  'rejects a duplicate $field without saving an invalid field list',
  async ({ variable, label, field }) => {
    const user = userEvent.setup()
    const error = vi.spyOn(toast, 'error')
    renderSnippet()
    const dialog = await fillNewField(user, variable, label)
    await user.click(dialog.getByRole('button', { name: 'common.operation.save' }))
    expect(error).toHaveBeenCalledWith(
      `appDebug.varKeyError.keyAlreadyExists:{"key":"appDebug.variableConfig.${field === 'variable' ? 'varName' : 'labelName'}"}`,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(api.save).not.toHaveBeenCalled()
  },
)
