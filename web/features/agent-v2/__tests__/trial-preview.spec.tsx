import type { TrialAgentPreviewResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentTrialPreview } from '../trial-preview'

const { fetchPreview } = vi.hoisted(() => ({
  fetchPreview: vi.fn<() => Promise<TrialAgentPreviewResponse>>(),
}))

vi.mock('@/service/console', () => ({
  consoleQuery: {
    trialApps: {
      byAppId: {
        agentPreview: {
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
}))

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
    system_prompt: 'You are a research assistant.',
    model: { provider: 'openai', model: 'gpt-4o' },
    tools: [{ name: 'search', description: 'Search the web' }],
    knowledge: [{ name: 'Handbook', description: 'Product documentation' }],
    skills: [{ name: 'Research', description: 'Research skill' }],
    files: [{ name: 'guide.txt', description: '' }],
  })
  const user = userEvent.setup()
  renderPreview()

  expect(await screen.findByText('You are a research assistant.')).toBeVisible()
  expect(screen.getByText('gpt-4o')).toBeVisible()
  expect(screen.getByText('Search the web')).toBeVisible()
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
