import type { PromptEditorProps } from '@/app/components/base/prompt-editor'
import { zKnowledgeFsSpaceListResponse } from '@dify/contracts/api/console/knowledge-fs/zod.gen'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { consoleQuery } from '@/service/client'
import {
  createConsoleQueryClient,
  renderWithConsoleQuery as render,
  seedSystemFeatures,
} from '@/test/console/query-data'
import { AgentOrchestratePanel } from '../index'

// Keep the panel, KnowledgeFS dialog, prompt commands and action registration real.
// Independent sections and Lexical selection are outside this entry-point contract.
vi.mock('../model-config/field', () => ({ AgentModelField: () => null }))
vi.mock('../skills', () => ({ AgentSkills: () => null }))
vi.mock('../files', () => ({ AgentFiles: () => null }))
vi.mock('../tools', () => ({ AgentTools: () => null }))
vi.mock('../advanced', () => ({ AgentAdvancedSettings: () => null }))
vi.mock('@/app/components/base/prompt-editor', () => ({
  default: (props: PromptEditorProps) => (
    <textarea
      aria-labelledby={props['aria-labelledby']}
      value={props.value}
      readOnly={!props.editable}
      onChange={(event) => props.onChange?.(event.target.value)}
    />
  ),
}))
vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: (selector: (state: { enableSkill: boolean }) => unknown) =>
    selector({ enableSkill: false }),
}))
vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: [] }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
}))
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
            permission_keys: ['knowledge_space_read', 'knowledge_space_query'],
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
        textGenerationModelList={[]}
        onSelectModel={vi.fn()}
        showHeader={false}
        showPublishBar={false}
        readOnly={readOnly}
      />
    </AgentComposerProvider>,
    { queryClient, systemFeatures: { agent_knowledge_fs_enabled: enabled } },
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
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: /prompt.label/ }).value,
    ).toMatch(/^\[§knowledge:[0-9a-f-]+:Product manual§\] $/)
    expect(screen.queryByRole('dialog', { name: /prompt.insert.label/ })).not.toBeInTheDocument()
    expect(screen.getByText('Product manual')).toBeInTheDocument()
  })

  it('explains unavailable runtime and follows capability updates without losing bindings', async () => {
    const user = userEvent.setup()
    const { queryClient } = setup({ enabled: false, configured: true })

    expect(screen.getByText('Product manual')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/knowledgeFs.runtimeUnavailable/)
    expect(screen.getByRole('button', { name: /knowledgeFs.add/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /prompt.insert.label/ }))
    expect(
      screen.queryByRole('button', { name: /knowledgeRetrieval.label/ }),
    ).not.toBeInTheDocument()

    act(() => {
      seedSystemFeatures(queryClient, { agent_knowledge_fs_enabled: true })
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
