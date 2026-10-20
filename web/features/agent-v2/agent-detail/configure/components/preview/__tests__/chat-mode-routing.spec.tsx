import type { ReactElement } from 'react'
import type { AgentChatRuntimeProps } from '../chat-runtime'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { render as renderConsole } from '@/test/console/render'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentBuildChat } from '../build-chat'
import { AgentPreviewChat } from '../preview-chat'

const runtimeState = vi.hoisted(() => ({ showUnconfiguredNotice: true }))

vi.mock('../../community-edition-tip', () => ({
  CommunityEditionTip: () => null,
}))

// The independently tested runtime decides whether the draft is configured.
vi.mock('../chat-runtime', () => ({
  AgentChatRuntime: ({ renderEmptyState }: AgentChatRuntimeProps) => renderEmptyState(runtimeState),
}))

const commonProps = {
  agentId: 'agent-1',
  clearChatList: false,
  onClearChatListChange: vi.fn(),
}

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  queryClient.setQueryData(
    consoleQuery.agent.byAgentId.get.queryKey({
      input: { params: { agent_id: commonProps.agentId } },
    }),
    createAgentFixture({ name: 'Research Agent' }),
  )
  return renderConsole(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
}

describe('Agent chat empty state', () => {
  beforeEach(() => {
    runtimeState.showUnconfiguredNotice = true
  })

  it.each([
    {
      mode: 'Build',
      Component: AgentBuildChat,
      description: 'agentV2.agentDetail.configure.build.empty.description',
    },
    {
      mode: 'Preview',
      Component: AgentPreviewChat,
      description: 'agentV2.agentDetail.configure.preview.empty.description',
    },
  ])(
    'shows $mode guidance only while its runtime reports an unconfigured draft',
    ({ mode, Component, description }) => {
      const { rerender } = render(<Component {...commonProps} />)
      expect(screen.getByText(description)).toBeVisible()
      if (mode === 'Preview') expect(screen.getByText('Research Agent')).toBeInTheDocument()
      const notice = 'agentV2.agentDetail.configure.preview.unconfiguredNotice'
      expect(screen.getByText(notice)).toBeVisible()
      runtimeState.showUnconfiguredNotice = false
      rerender(<Component {...commonProps} />)
      expect(screen.getByText(notice)).not.toBeVisible()
    },
  )
})
