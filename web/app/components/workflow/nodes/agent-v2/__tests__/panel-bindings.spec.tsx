import type {
  AgentAppComposerResponse,
  AgentInviteOptionsResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { WorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import { zAgentAppComposerResponse } from '@dify/contracts/api/console/agent/zod.gen'
import { zWorkflowAgentComposerResponse } from '@dify/contracts/api/console/apps/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import { createData, createPanelEnvironment } from './panel-test-env'

const api = vi.hoisted(() => ({
  loadComposer: vi.fn(),
  copyApp: vi.fn(),
  copySnippet: vi.fn(),
  saveComposer: vi.fn(),
  saveToRoster: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get': api.loadComposer,
      'snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.get': api.loadComposer,
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.copyFromRoster.post': api.copyApp,
      'snippets.bySnippetId.workflows.draft.nodes.byNodeId.agentComposer.copyFromRoster.post':
        api.copySnippet,
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.put': api.saveComposer,
      'apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.saveToRoster.post':
        api.saveToRoster,
      'agent.byAgentId.buildDraft.get': () =>
        Promise.reject(
          createHttpError(new Response(null, { status: 404 }), { message: 'No build draft' }),
        ),
    }),
  }
})

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-1' }),
  usePathname: () => '/app/app-1/workflow',
}))

const inlineBinding = {
  binding_type: 'inline_agent' as const,
  agent_id: 'inline-agent',
  current_snapshot_id: 'snapshot-1',
}
const createComposer = (overrides: Partial<WorkflowAgentComposerResponse> = {}) =>
  zWorkflowAgentComposerResponse.parse({
    variant: 'workflow',
    agent_soul: { schema_version: 1, prompt: { system_prompt: 'Follow the request' } },
    node_job: {},
    save_options: [],
    soul_lock: { locked: false },
    agent: {
      id: 'inline-agent',
      name: 'Inline Agent',
      description: '',
      scope: 'workflow_only',
      status: 'active',
    },
    binding: {
      ...inlineBinding,
      id: 'binding-1',
      node_id: 'agent-node',
      workflow_id: 'workflow-1',
    },
    ...overrides,
  } satisfies WorkflowAgentComposerResponse)
const rosterComposer = zAgentAppComposerResponse.parse({
  variant: 'agent_app',
  active_config_is_published: true,
  save_options: [],
  agent: { id: 'agent-1', name: 'Nadia', description: '', scope: 'roster', status: 'active' },
  agent_soul: { schema_version: 1, prompt: { system_prompt: 'Read-only roster instructions' } },
} satisfies AgentAppComposerResponse)
const rosterPrefix = 'workflowAgent.nodes.agent.roster'
const trigger = () => screen.getByRole('button', { name: new RegExp(`${rosterPrefix}.openPanel`) })
const environment = (options: Parameters<typeof createPanelEnvironment>[0] = {}) => {
  const env = createPanelEnvironment(options)
  env.queryClient.setQueryData(
    consoleQuery.agent.byAgentId.composer.get.queryKey({
      input: { params: { agent_id: 'agent-1' } },
    }),
    rosterComposer,
  )
  for (const agentId of ['agent-1', 'inline-agent', 'saved-agent']) {
    env.queryClient.setQueryData(
      consoleQuery.workspaces.current.agents.byAgentId.skills.get.queryKey({
        input: { params: { agent_id: agentId } },
      }),
      { agent_id: agentId, data: [] },
    )
  }
  env.queryClient.setQueryData(
    consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: 'agent-2' } } }),
    createAgentFixture({ id: 'agent-2', name: 'Mara' }),
  )
  return env
}
const seedInline = (env: ReturnType<typeof environment>, composer = createComposer()) => {
  env.queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.queryKey({
      input: { params: { app_id: 'app-1', node_id: 'agent-node' } },
    }),
    composer,
  )
}

beforeEach(() => {
  api.loadComposer.mockReset().mockResolvedValue(createComposer())
  api.copyApp.mockReset().mockResolvedValue(createComposer())
  api.copySnippet.mockReset().mockResolvedValue(createComposer())
  api.saveComposer.mockReset().mockResolvedValue(createComposer())
  api.saveToRoster.mockReset().mockResolvedValue(
    createComposer({
      binding: {
        ...createComposer().binding!,
        binding_type: 'roster_agent',
        agent_id: 'saved-agent',
      },
    }),
  )
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (new URL(url).pathname !== '/console/api/agent/invite-options')
      throw new Error(`Unexpected request: ${url}`)
    return Response.json({
      data: [
        {
          id: 'agent-2',
          name: 'Mara',
          description: 'Tender Analyst',
          icon: 'M',
          icon_background: '#D1E9FF',
          icon_type: 'emoji',
          role: 'Analyst',
          agent_kind: 'dify_agent',
          scope: 'roster',
          source: 'roster',
          status: 'active',
          active_config_snapshot_id: 'snapshot-2',
        },
      ],
      has_more: false,
      limit: 8,
      page: 1,
      total: 1,
    } satisfies AgentInviteOptionsResponse)
  })
})

describe('Agent panel bindings', () => {
  it('opens the roster instructions read-only and links to their owning console', async () => {
    const user = userEvent.setup()
    const env = environment()
    env.render()
    await user.click(trigger())
    const dialog = within(await screen.findByRole('dialog', { name: 'Nadia' }))
    expect(dialog.getByRole('link', { name: `${rosterPrefix}.editInConsole` })).toHaveAttribute(
      'href',
      '/agents/agent-1/configure',
    )
    expect(await dialog.findByText('Read-only roster instructions')).toBeVisible()
    expect(dialog.getByRole('textbox')).toHaveAttribute('contenteditable', 'false')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Nadia' })).not.toBeInTheDocument(),
    )
  })

  it('requires an agent and persists a roster selection from the real selector', async () => {
    const user = userEvent.setup()
    const env = environment({ data: createData({ agent_binding: undefined }) })
    env.render()
    expect(screen.getByText(/^workflow.errorMsg.fieldRequired/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: `${rosterPrefix}.change` }))
    await user.click(await screen.findByRole('menuitem', { name: /Mara/ }))
    await waitFor(() =>
      expect(env.getNodeData().agent_binding).toEqual({
        binding_type: 'roster_agent',
        agent_id: 'agent-2',
      }),
    )
    expect(await screen.findByText('Mara')).toBeVisible()
    expect(screen.queryByText(/^workflow.errorMsg.fieldRequired/)).not.toBeInTheDocument()
    expect(env.syncDraft).toHaveBeenCalled()
  })

  it.each([
    { kind: 'app', appId: 'app-1', mode: 'workflow' },
    { kind: 'snippet', snippetId: 'snippet-1' },
  ] satisfies EditorResource[])(
    'copies a roster agent through the $kind endpoint and opens the new inline agent',
    async (resource) => {
      const user = userEvent.setup()
      const env = environment({ resource })
      env.render()
      await user.click(trigger())
      await user.click(screen.getByRole('button', { name: `${rosterPrefix}.makeCopy` }))
      const request = resource.kind === 'app' ? api.copyApp : api.copySnippet
      await waitFor(() =>
        expect(request).toHaveBeenCalledExactlyOnceWith({
          params:
            resource.kind === 'app'
              ? { app_id: 'app-1', node_id: 'agent-node' }
              : { snippet_id: 'snippet-1', node_id: 'agent-node' },
          body: { source_agent_id: 'agent-1' },
        }),
      )
      await waitFor(() => expect(env.getNodeData().agent_binding).toEqual(inlineBinding))
      expect(await screen.findByText('Follow the request')).toBeVisible()
      expect(env.syncDraft).toHaveBeenCalled()
    },
  )

  it('keeps a new binding pending until creation completes and preserves the task and outputs', async () => {
    const user = userEvent.setup()
    const created = createDeferred<WorkflowAgentComposerResponse>()
    api.saveComposer.mockReturnValue(created.promise)
    const outputs = [{ name: 'report', type: 'string' as const }]
    const env = environment({
      data: createData({ agent_task: 'Review tender', agent_declared_outputs: outputs }),
    })
    env.render()
    await user.click(screen.getByRole('button', { name: `${rosterPrefix}.change` }))
    await user.click(await screen.findByRole('menuitem', { name: /startFromScratch/ }))
    await waitFor(() =>
      expect(env.getNodeData().agent_binding).toEqual({ binding_type: 'inline_agent' }),
    )
    expect(screen.queryByText('Follow the request')).not.toBeInTheDocument()
    await act(async () => created.resolve(createComposer()))
    await waitFor(() => expect(env.getNodeData().agent_binding).toEqual(inlineBinding))
    expect(env.getNodeData()).toMatchObject({
      agent_task: 'Review tender',
      agent_declared_outputs: outputs,
    })
    expect(await screen.findByText('Follow the request')).toBeVisible()
    expect(api.saveComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { app_id: 'app-1', node_id: 'agent-node' },
        body: expect.objectContaining({
          variant: 'workflow',
          save_strategy: 'node_job_only',
          binding: { binding_type: 'inline_agent' },
        }),
      }),
    )
  })

  it.each([false, true])(
    'waits for its composer before opening an inline panel (requested by graph: %s)',
    async (openOnLoad) => {
      const user = userEvent.setup()
      const loaded = createDeferred<WorkflowAgentComposerResponse>()
      api.loadComposer.mockReturnValue(loaded.promise)
      const env = environment({
        data: createData({ agent_binding: inlineBinding, _openInlineAgentPanel: openOnLoad }),
      })
      env.render()
      expect(
        screen.queryByRole('button', { name: new RegExp(`${rosterPrefix}.openPanel`) }),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await act(async () => loaded.resolve(createComposer()))
      if (!openOnLoad) {
        await screen.findByRole('button', { name: new RegExp(`${rosterPrefix}.openPanel`) })
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        await user.click(trigger())
      }
      expect(await screen.findByText('Follow the request')).toBeVisible()
    },
  )

  it('retains the ready trigger while refetching an existing inline agent', async () => {
    const user = userEvent.setup()
    const loaded = createDeferred<WorkflowAgentComposerResponse>()
    api.loadComposer.mockReturnValue(loaded.promise)
    const env = environment({ data: createData({ agent_binding: inlineBinding }) })
    seedInline(env)
    env.render()
    const rosterTrigger = trigger()
    await user.click(rosterTrigger)
    await waitFor(() => expect(api.loadComposer).toHaveBeenCalled())
    expect(rosterTrigger).not.toHaveAttribute('aria-busy')
    expect(await screen.findByText('Follow the request')).toBeVisible()
    await act(async () => loaded.resolve(createComposer()))
  })

  it('retries a failed composer request and then opens the recovered agent', async () => {
    const user = userEvent.setup()
    api.loadComposer.mockRejectedValue(new Error('Composer unavailable'))
    const env = environment({ data: createData({ agent_binding: inlineBinding }) })
    env.queryClient.setQueryDefaults(
      consoleQuery.apps.byAppId.workflows.draft.nodes.byNodeId.agentComposer.get.key(),
      { retryDelay: 0 },
    )
    env.render()
    const retry = await screen.findByRole('button', { name: 'common.operation.retry' })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'agentRoster.roster.nodeSelector.createInlineFailed',
    )
    api.loadComposer.mockResolvedValue(createComposer())
    await user.click(retry)
    await user.click(
      await screen.findByRole('button', { name: new RegExp(`${rosterPrefix}.openPanel`) }),
    )
    expect(await screen.findByText('Follow the request')).toBeVisible()
  })

  it('opens a pending inline binding and completes creation through the composer service', async () => {
    const user = userEvent.setup()
    const env = environment({
      data: createData({ agent_binding: { binding_type: 'inline_agent' } }),
    })
    env.render()
    expect(trigger()).toHaveAttribute('aria-busy', 'true')
    await user.click(trigger())
    expect(await screen.findByText('Follow the request')).toBeVisible()
    expect(api.saveComposer).toHaveBeenCalledOnce()
    expect(env.getNodeData().agent_binding).toEqual(inlineBinding)
  })

  it('does not offer another blank inline agent for an existing inline binding', async () => {
    const user = userEvent.setup()
    const env = environment({ data: createData({ agent_binding: inlineBinding }) })
    seedInline(env)
    env.render()
    await user.click(screen.getByRole('button', { name: `${rosterPrefix}.change` }))
    await screen.findByRole('menuitem', { name: /Mara/ })
    expect(screen.queryByRole('menuitem', { name: /startFromScratch/ })).not.toBeInTheDocument()
  })

  it('saves an inline agent to the roster through the workspace menu and rebinds the node', async () => {
    const user = userEvent.setup()
    const env = environment({ data: createData({ agent_binding: inlineBinding }) })
    seedInline(env)
    env.queryClient.setQueryData(
      consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: 'saved-agent' } } }),
      createAgentFixture({ id: 'saved-agent', name: 'Saved Agent' }),
    )
    env.queryClient.setQueryData(
      consoleQuery.agent.byAgentId.composer.get.queryKey({
        input: { params: { agent_id: 'saved-agent' } },
      }),
      {
        ...rosterComposer,
        agent: { ...rosterComposer.agent, id: 'saved-agent', name: 'Saved Agent' },
      },
    )
    env.render()
    await user.click(trigger())
    await screen.findByText('Follow the request')
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'agentRoster.roster.saveToRoster' }),
    )
    const dialog = within(
      await screen.findByRole('dialog', { name: 'agentRoster.roster.saveToRosterDialog.title' }),
    )
    await user.type(dialog.getByRole('textbox', { name: /name/i }), 'Saved Agent')
    await user.click(dialog.getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() =>
      expect(env.getNodeData().agent_binding).toEqual({
        binding_type: 'roster_agent',
        agent_id: 'saved-agent',
      }),
    )
    expect(await screen.findByRole('dialog', { name: 'Saved Agent' })).toBeVisible()
    expect(api.saveToRoster).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          new_agent_name: 'Saved Agent',
          save_strategy: 'save_to_roster',
        }),
      }),
    )
  })

  it('updates the graph snapshot when the real inline workspace saves a changed prompt', async () => {
    const user = userEvent.setup()
    const env = environment({ data: createData({ agent_binding: inlineBinding }) })
    seedInline(env)
    api.saveComposer.mockResolvedValue(
      createComposer({
        binding: { ...createComposer().binding!, current_snapshot_id: 'snapshot-2' },
        agent_soul: { prompt: { system_prompt: 'New instructions' } },
      }),
    )
    env.render()
    await user.click(trigger())
    await screen.findByText('Follow the request')
    const dialog = within(screen.getByRole('dialog'))
    const editor = dialog.getByRole('textbox', {
      name: 'agentV2.agentDetail.configure.prompt.label',
    })
    await user.click(editor)
    await user.paste(' New instructions')
    await user.click(dialog.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() =>
      expect(env.getNodeData().agent_binding).toEqual({
        ...inlineBinding,
        current_snapshot_id: 'snapshot-2',
      }),
    )
    expect(api.saveComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          agent_soul: expect.objectContaining({
            prompt: expect.objectContaining({
              system_prompt: expect.stringContaining('New instructions'),
            }),
          }),
        }),
      }),
    )
  })

  it('recovers an inline panel requested by the workflow graph', async () => {
    const env = environment({
      data: createData({ agent_binding: inlineBinding, _openInlineAgentPanel: true }),
    })
    seedInline(env)
    env.render()
    expect(await screen.findByText('Follow the request')).toBeVisible()
    await waitFor(() => expect(env.getNodeData()._openInlineAgentPanel).toBe(false))
  })
})
