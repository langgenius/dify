import type { AgentAppComposerResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentTrialPreview } from '../trial-preview'

const { fetchPreview } = vi.hoisted(() => ({
  fetchPreview: vi.fn<() => Promise<AgentAppComposerResponse>>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/service/console')>()
  return {
    ...original,
    consoleQuery: {
      workspaces: original.consoleQuery.workspaces,
      trialApps: {
        byAppId: {
          agentComposer: {
            get: {
              queryOptions: ({ input }: { input: { params: { app_id: string } } }) => ({
                queryKey: ['trial-preview', input.params.app_id],
                queryFn: fetchPreview,
              }),
            },
          },
        },
      },
    },
  }
})

// The editable model picker must never be mounted by a public preview.
vi.mock(
  '@/app/components/header/account-setting/model-provider-page/model-parameter-modal',
  () => ({
    default: () => {
      throw new Error('Editable model picker mounted')
    },
  }),
)

function renderPreview() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AgentTrialPreview appId="sample-app" />
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())

it('shows published configuration with read-only collapsible sections', async () => {
  fetchPreview.mockResolvedValue({
    variant: 'agent_app',
    agent: { id: 'agent-1', name: 'Research', description: '', scope: 'roster', status: 'active' },
    active_config_is_published: true,
    save_options: [],
    agent_soul: {
      prompt: { system_prompt: 'You are a research assistant.' },
      model: { plugin_id: 'openai', model_provider: 'openai', model: 'gpt-4o' },
      tools: {
        dify_tools: [
          {
            provider_type: 'api',
            provider_id: 'search',
            tool_name: 'search',
            description: 'Search the web',
          },
        ],
        cli_tools: [
          { name: 'Search CLI', description: 'Search with CLI' },
          { name: 'Disabled CLI', enabled: false },
        ],
      },
      knowledge: {
        sets: [
          {
            id: 'knowledge-1',
            name: 'Handbook',
            description: 'Product documentation',
            datasets: [{ id: 'dataset-1' }],
            query: { mode: 'user_query', value: 'query' },
            retrieval: { mode: 'single' },
          },
        ],
      },
      config_skills: [{ name: 'Research', description: 'Research skill', file_id: 'skill-1' }],
      config_files: [{ name: 'guide.txt', file_kind: 'upload_file', file_id: 'file-1' }],
    },
  })
  const user = userEvent.setup()
  renderPreview()

  expect(await screen.findByText('You are a research assistant.')).toBeVisible()
  expect(screen.getByText('gpt-4o')).toBeVisible()
  expect(screen.getByText('Search the web')).toBeVisible()
  expect(screen.getByText('Search with CLI')).toBeVisible()
  expect(screen.queryByText('Disabled CLI')).not.toBeInTheDocument()
  expect(screen.getByText('Handbook')).toBeVisible()
  expect(screen.getByText('guide.txt')).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'agentV2.agentDetail.configure.skills.label' }),
  )
  expect(screen.queryByText('Research skill')).not.toBeInTheDocument()
  expect(fetchPreview).toHaveBeenCalledTimes(1)
})

it('shows unavailable instead of stale configuration when preview fails', async () => {
  fetchPreview.mockRejectedValue(new Error('Not published'))
  renderPreview()
  expect(await screen.findByText('share.common.appUnavailable')).toBeVisible()
})

it('renders a published composer response without optional resources', async () => {
  fetchPreview.mockResolvedValue({
    variant: 'agent_app',
    agent: { id: 'agent-1', name: 'Research', description: '', scope: 'roster', status: 'active' },
    active_config_is_published: true,
    save_options: [],
    agent_soul: {
      prompt: { system_prompt: 'No resources configured.' },
      model: { plugin_id: 'openai', model_provider: 'openai', model: 'gpt-4o' },
    },
  })
  renderPreview()
  expect(await screen.findByText('No resources configured.')).toBeVisible()
  expect(screen.getAllByText('common.noData')).toHaveLength(4)
})
