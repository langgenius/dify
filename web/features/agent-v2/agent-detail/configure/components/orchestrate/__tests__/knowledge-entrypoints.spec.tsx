import { zKnowledgeFsSpaceListResponse } from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { consoleQuery } from '@/service/console'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
  seedKnowledgeFsFeatures,
} from '@/test/console/query-data'
import { AgentOrchestratePanel } from '../index'

// Keep the panel, prompt editor, KnowledgeFS dialog, prompt commands and action registration real.
// Independent sections are outside this entry-point contract.
vi.mock('../model-config/field', () => ({ AgentModelField: () => null }))
vi.mock('../skills', () => ({ AgentSkills: () => null }))
vi.mock('../files', () => ({ AgentFiles: () => null }))
vi.mock('../tools', () => ({ AgentTools: () => null }))
vi.mock('../advanced', () => ({ AgentAdvancedSettings: () => null }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  const emptyToolList = async () => []
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.tools.api.get': emptyToolList,
      'workspaces.current.tools.builtin.get': emptyToolList,
      'workspaces.current.tools.mcp.get': emptyToolList,
      'workspaces.current.tools.workflow.get': emptyToolList,
    }),
  }
})
vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: 'light' }) }))
vi.mock('@/context/i18n', () => ({
  useGetLanguage: () => 'en_US',
  useDocLink: () => () => 'https://docs.example.com',
}))

const SPACE = '00000000-0000-4000-8000-000000000001'
const binding = { id: 'docs', controlSpaceId: SPACE, name: 'Product manual' }

function setup({ enabled = true, workflow = false, readOnly = false, configured = false } = {}) {
  const queryClient = createConsoleQueryClient()
  const options = consoleQuery.knowledgeFs.spaces.get.infiniteOptions({
    input: (pageParam) => ({ query: { limit: 50, page: pageParam } }),
    initialPageParam: 1,
    getNextPageParam: () => undefined,
  })
  queryClient.setQueryData(options.queryKey, {
    pages: [
      zKnowledgeFsSpaceListResponse.parse({
        data: [
          {
            control_space_id: SPACE,
            knowledge_space_id: SPACE,
            created_at: '2026-09-07T00:00:00Z',
            updated_at: '2026-09-07T00:00:00Z',
            linked_apps: 0,
            owner_account_id: 'account',
            permission_keys: [
              'knowledge_space_read',
              'knowledge_space_query',
              'knowledge_space_access_config',
            ],
            resource_version: 1,
            state: 'active',
            technical_status: 'available',
            visibility: 'only_me',
            technical_summary: {
              knowledge_space_id: SPACE,
              name: 'Product manual',
              description: 'Product documentation',
              revision: 1,
              slug: 'product-manual',
            },
          },
        ],
        page: 1,
        limit: 50,
        has_more: false,
      }),
    ],
    pageParams: [1],
  })
  return render(
    <AgentComposerProvider
      initialDraft={{
        ...defaultAgentSoulConfigFormState,
        knowledgeRetrievals: configured ? [binding] : [],
      }}
    >
      <AgentOrchestratePanel
        agentId="agent-1"
        {...(workflow ? { appId: 'workflow-1', nodeId: 'node-1' } : {})}
        onSelectModel={vi.fn()}
        showHeader={false}
        showPublishBar={false}
        readOnly={readOnly}
      />
    </AgentComposerProvider>,
    {
      queryClient,
      features: { enable_skill: false },
      knowledgeFsFeatures: { agent_enabled: enabled },
    },
  )
}

async function confirmSpace(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: /knowledgeFs.title/ })
  await user.click(within(dialog).getByRole('checkbox', { name: 'Product manual' }))
  await user.click(within(dialog).getByRole('button', { name: /operation.confirm/ }))
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
}

describe('KnowledgeFS entry points in the real Agent configuration panel', () => {
  it.each([false, true])(
    'can add a knowledge space from the panel (workflow=%s)',
    async (workflow) => {
      const user = userEvent.setup()
      setup({ workflow })

      expect(await screen.findByRole('heading', { name: /knowledgeFs.title/ })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /knowledgeFs.add/ }))
      await confirmSpace(user)

      expect(screen.getByText('Product manual')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /knowledgeFs.add/ }))
      const dialog = await screen.findByRole('dialog', { name: /knowledgeFs.title/ })
      expect(within(dialog).getByRole('checkbox', { name: 'Product manual' })).toHaveAttribute(
        'aria-checked',
        'true',
      )
    },
  )

  it('adds a KnowledgeFS binding from the prompt menu and inserts its reference', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: /prompt.insert.label/ }))
    await user.click(screen.getByRole('button', { name: /knowledgeRetrieval.label/ }))
    await user.click(screen.getByRole('button', { name: /knowledgeRetrieval.add/ }))
    await confirmSpace(user)

    expect(
      within(screen.getByRole('textbox', { name: /prompt.label/ })).getByText('Product manual'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /prompt.insert.label/ })).not.toBeInTheDocument()
    // One reference in the prompt and one binding in the knowledge section.
    expect(screen.getAllByText('Product manual')).toHaveLength(2)
  })

  it('explains unavailable runtime and follows capability updates without losing bindings', async () => {
    const user = userEvent.setup()
    const { queryClient } = setup({ enabled: false, configured: true })

    expect(screen.getByText('Product manual')).toBeInTheDocument()
    expect(screen.getByRole('status').textContent).toMatch(/knowledgeFs.runtimeUnavailable/)
    expect(screen.getByRole('button', { name: /knowledgeFs.add/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /prompt.insert.label/ }))
    expect(
      screen.queryByRole('button', { name: /knowledgeRetrieval.label/ }),
    ).not.toBeInTheDocument()

    act(() => {
      seedKnowledgeFsFeatures(queryClient, { agent_enabled: true })
    })

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /knowledgeFs.add/ })).toBeEnabled(),
    )
    expect(
      await screen.findByRole('button', { name: /knowledgeRetrieval.label/ }),
    ).toBeInTheDocument()
    expect(screen.getByText('Product manual')).toBeInTheDocument()
  })

  it('shows a bound knowledge space without editing controls in a read-only Workflow panel', async () => {
    setup({ workflow: true, readOnly: true, configured: true })

    expect(await screen.findByRole('heading', { name: /knowledgeFs.title/ })).toBeInTheDocument()
    expect(screen.getByText('Product manual')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /knowledgeFs.add/ })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: /knowledgeRetrieval.edit/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /knowledgeRetrieval.remove/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /prompt.insert.label/ })).not.toBeInTheDocument()
  })
})
