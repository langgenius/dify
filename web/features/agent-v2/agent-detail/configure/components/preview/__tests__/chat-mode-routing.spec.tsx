import type { AgentChatMessageSender } from '../chat-conversation'
import type { AgentChatRuntimeProps } from '../chat-runtime'
import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import { AgentBuildChat } from '../build-chat'
import { sendBuildChatMessage } from '../build-chat-request'
import { AgentPreviewChat } from '../preview-chat'
import { sendPreviewChatMessage } from '../preview-chat-request'

const runtimePropsMock = vi.hoisted(() => vi.fn())

vi.mock('../chat-runtime', () => ({
  AgentChatRuntime: (
    props: Pick<AgentChatRuntimeProps, 'draftType'> & { sendMessage: AgentChatMessageSender },
  ) => {
    runtimePropsMock(props)
    return null
  },
}))

const commonProps = {
  agentId: 'agent-1',
  clearChatList: false,
  onClearChatListChange: vi.fn(),
}

describe('Agent chat mode request routing', () => {
  beforeEach(() => {
    runtimePropsMock.mockClear()
  })

  it('should wire Build chat to the Build request implementation', () => {
    render(<AgentBuildChat {...commonProps} />)

    expect(runtimePropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        draftType: 'debug_build',
        sendMessage: sendBuildChatMessage,
      }),
    )
  })

  it('should wire Preview chat to the Preview request implementation', () => {
    render(<AgentPreviewChat {...commonProps} />)

    expect(runtimePropsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sendMessage: sendPreviewChatMessage,
      }),
    )
    expect(runtimePropsMock.mock.calls.at(-1)?.[0]).not.toHaveProperty('draftType')
  })

  it('should show only the agent name in the Preview empty-state title', () => {
    render(<AgentPreviewChat {...commonProps} agentName="Research Agent" />)

    const renderEmptyState = runtimePropsMock.mock.calls.at(-1)?.[0].renderEmptyState
    render(
      renderEmptyState({
        agentName: 'Research Agent',
        hasInstructions: true,
      }),
    )

    expect(screen.getByText('Research Agent')).toBeInTheDocument()
    expect(screen.queryByText('Preview Research Agent')).not.toBeInTheDocument()
  })
})
