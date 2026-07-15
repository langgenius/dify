import type { ChatItem } from '../../../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { AgentRosterResponseContent } from '../agent-roster-response-content'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('../../../../../../../test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock({
      'agentV2.agentDetail.configure.answer.thinking': 'Thinking',
      'agentV2.agentDetail.configure.answer.duration.minute': '{{count}}m',
      'agentV2.agentDetail.configure.answer.duration.second': '{{count}}s',
      'agentV2.agentDetail.configure.answer.activity.ranCommands': 'Ran commands',
      'agentV2.agentDetail.configure.answer.activity.runningCommands': 'Running commands',
    }),
  }
})

describe('AgentRosterResponseContent', () => {
  it('should render historical agent thought answer as markdown instead of thought process', async () => {
    const user = userEvent.setup()
    const item = {
      id: 'answer-history',
      content: '',
      isAnswer: true,
      agent_thoughts: [
        {
          id: 'thought-with-answer',
          thought: 'internal thought should not render',
          answer: '**history answer**',
          tool: '',
          tool_input: '',
          observation: '',
          message_id: 'answer-history',
          conversation_id: 'conversation-history',
          position: 1,
        },
      ],
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} />)

    const processToggle = screen.getByRole('button', { name: 'Thinking' })
    expect(processToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('history answer')).not.toBeInTheDocument()

    await user.click(processToggle)

    expect(processToggle).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => {
      expect(screen.getByText('history answer')).toBeInTheDocument()
    })

    expect(screen.queryByText('internal thought should not render')).not.toBeInTheDocument()
  })

  it('should keep one collapsible thinking timeline while response parts interleave', async () => {
    const user = userEvent.setup()
    const item = {
      id: 'answer-1',
      content: 'first answer second answer',
      isAnswer: true,
      agent_response_parts: [
        {
          type: 'thought',
          thought: {
            id: 'thought-1',
            thought: 'raw first thought',
            tool: 'load_tools',
            tool_input: '',
            tool_labels: {
              load_tools: {
                en_US: 'Loaded tools',
                zh_Hans: '已加载工具',
              },
              shell_run: {
                en_US: 'Ran commands',
                zh_Hans: '运行了命令',
              },
            },
            observation: '',
            message_id: 'answer-1',
            conversation_id: 'conversation-1',
            position: 1,
          },
        },
        {
          type: 'message',
          content: 'first answer',
        },
        {
          type: 'thought',
          thought: {
            id: 'thought-2',
            thought: 'raw second thought',
            tool: 'shell_run',
            tool_input: '',
            tool_labels: {
              load_tools: {
                en_US: 'Loaded tools',
                zh_Hans: '已加载工具',
              },
              shell_run: {
                en_US: 'Ran commands',
                zh_Hans: '运行了命令',
              },
            },
            observation: '',
            message_id: 'answer-1',
            conversation_id: 'conversation-1',
            position: 2,
          },
        },
        {
          type: 'message',
          content: 'second answer',
        },
      ],
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} responding />)

    const processToggle = screen.getByRole('button', { name: /Thinking/ })
    expect(processToggle).toHaveAttribute('aria-expanded', 'true')

    await waitFor(() => {
      expect(screen.getByTestId('agent-roster-response-content')).toHaveTextContent('second answer')
    })

    const content = screen.getByTestId('agent-roster-response-content').textContent ?? ''
    expect(content.indexOf('Loaded tools')).toBeLessThan(content.indexOf('first answer'))
    expect(content.indexOf('first answer')).toBeLessThan(content.indexOf('Ran commands'))
    expect(content.indexOf('Ran commands')).toBeLessThan(content.indexOf('second answer'))
    expect(screen.queryByText('raw first thought')).not.toBeInTheDocument()
    expect(screen.queryByText('raw second thought')).not.toBeInTheDocument()

    await user.click(processToggle)

    expect(processToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Loaded tools')).not.toBeInTheDocument()
  })

  it('should keep activity labels stable when their details are expanded', async () => {
    const user = userEvent.setup()
    const item = {
      id: 'answer-expanded-thought',
      content: '',
      isAnswer: true,
      agent_thoughts: [
        {
          id: 'thought-expanded',
          thought: '',
          tool: 'shell_run',
          tool_input: '{"command":"ls"}',
          tool_labels: {
            shell_run: {
              en_US: 'Ran commands',
              zh_Hans: '运行了命令',
            },
          },
          observation: 'README.md',
          message_id: 'answer-expanded-thought',
          conversation_id: 'conversation-expanded-thought',
          position: 1,
        },
      ],
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} />)

    await user.click(screen.getByRole('button', { name: 'Thinking' }))

    const activityToggle = screen.getByRole('button', { name: 'Ran commands' })
    expect(activityToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(activityToggle)

    expect(activityToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Ran commands' })).toBe(activityToggle)
    expect(screen.getByText('{"command":"ls"}')).toBeInTheDocument()
  })

  it('should use the shell activity fallback only when no descriptive label is available', async () => {
    const user = userEvent.setup()
    const item = {
      id: 'answer-shell-labels',
      content: '',
      isAnswer: true,
      agent_thoughts: [
        {
          id: 'thought-shell-fallback',
          thought: '',
          tool: 'shell_run',
          tool_input: 'pwd',
          observation: '/workspace',
          message_id: 'answer-shell-labels',
          conversation_id: 'conversation-shell-labels',
          position: 1,
        },
        {
          id: 'thought-shell-described',
          thought: '',
          tool: 'shell_run',
          tool_input: 'mkdir skill',
          tool_labels: {
            shell_run: {
              en_US: 'Scaffold skill directory',
              zh_Hans: '创建技能目录',
            },
          },
          observation: '',
          message_id: 'answer-shell-labels',
          conversation_id: 'conversation-shell-labels',
          position: 2,
        },
      ],
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} />)

    await user.click(screen.getByRole('button', { name: 'Thinking' }))

    expect(screen.getByRole('button', { name: 'Ran commands' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scaffold skill directory' })).toBeInTheDocument()
  })

  it('should describe an unfinished shell run as running commands', () => {
    const item = {
      id: 'answer-running-shell',
      content: '',
      isAnswer: true,
      agent_response_parts: [
        {
          type: 'thought',
          thought: {
            id: 'thought-running-shell',
            thought: '',
            tool: 'shell_run',
            tool_input: 'pnpm test',
            observation: '',
            message_id: 'answer-running-shell',
            conversation_id: 'conversation-running-shell',
            position: 1,
          },
        },
      ],
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} responding />)

    expect(screen.getByRole('button', { name: 'Running commands' })).toBeInTheDocument()
  })

  it('should keep the live activity disclosure open when public messages arrive and completion starts', () => {
    const thought = {
      id: 'thought-transition',
      thought: 'raw thinking',
      tool: 'shell_run',
      tool_input: '{"command":"ls"}',
      tool_labels: {
        shell_run: {
          en_US: 'Ran commands',
          zh_Hans: '运行了命令',
        },
      },
      observation: 'README.md',
      message_id: 'answer-transition',
      conversation_id: 'conversation-transition',
      position: 1,
    }
    const item = {
      id: 'answer-transition',
      content: '',
      isAnswer: true,
      agent_response_parts: [
        {
          type: 'thought',
          thought,
        },
      ],
    } satisfies ChatItem

    const { rerender } = render(<AgentRosterResponseContent item={item} responding />)

    expect(screen.getByRole('button', { name: /Thinking/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    const itemWithMessage = {
      ...item,
      agent_response_parts: [
        ...item.agent_response_parts,
        {
          type: 'message',
          content: 'public answer',
        },
      ],
    } satisfies ChatItem

    rerender(<AgentRosterResponseContent item={itemWithMessage} responding />)

    expect(screen.getByRole('button', { name: /Thinking/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByText('public answer')).toBeInTheDocument()

    rerender(<AgentRosterResponseContent item={itemWithMessage} responding={false} />)

    expect(screen.getByRole('button', { name: /Thinking/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )

    rerender(
      <AgentRosterResponseContent
        item={{
          ...item,
          content: 'final answer',
          agent_response_parts: undefined,
          agent_thoughts: [thought],
        }}
        content="final answer"
        responding={false}
      />,
    )

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByText('final answer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ran commands' })).not.toBeInTheDocument()
  })

  it('should preserve a manual live activity collapse as new events arrive', async () => {
    const user = userEvent.setup()
    const item = {
      id: 'answer-manual-collapse',
      content: '',
      isAnswer: true,
      agent_response_parts: [
        {
          type: 'thought',
          thought: {
            id: 'thought-manual-collapse',
            thought: '',
            tool: 'shell_run',
            tool_input: 'pwd',
            observation: '/workspace',
            message_id: 'answer-manual-collapse',
            conversation_id: 'conversation-manual-collapse',
            position: 1,
          },
        },
      ],
    } satisfies ChatItem

    const { rerender } = render(<AgentRosterResponseContent item={item} responding />)
    const processToggle = screen.getByRole('button', { name: /Thinking/ })

    await user.click(processToggle)
    expect(processToggle).toHaveAttribute('aria-expanded', 'false')

    rerender(
      <AgentRosterResponseContent
        item={{
          ...item,
          agent_response_parts: [
            ...item.agent_response_parts,
            { type: 'message', content: 'new progress update' },
          ],
        }}
        responding
      />,
    )

    expect(screen.getByRole('button', { name: /Thinking/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByText('new progress update')).not.toBeInTheDocument()
  })

  it('should keep a historical answer and its activity in the same process entry', async () => {
    const user = userEvent.setup()
    const item = {
      id: 'answer-history-with-activity',
      content: 'final answer',
      isAnswer: true,
      agent_thoughts: [
        {
          id: 'thought-history-with-activity',
          thought: 'internal thought should not render',
          answer: 'public progress update',
          tool: 'shell_run',
          tool_input: 'pwd',
          observation: '/workspace',
          message_id: 'answer-history-with-activity',
          conversation_id: 'conversation-history-with-activity',
          position: 1,
        },
      ],
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} content={item.content} />)

    await user.click(screen.getByRole('button', { name: 'Thinking' }))

    expect(screen.getByText('public progress update')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ran commands' })).toBeInTheDocument()
    expect(screen.getByText('final answer')).toBeInTheDocument()
    expect(screen.queryByText('internal thought should not render')).not.toBeInTheDocument()
  })

  it('should render a live message directly when there is no activity', () => {
    const item = {
      id: 'answer-live-message-only',
      content: '',
      isAnswer: true,
      agent_response_parts: [{ type: 'message', content: 'direct answer' }],
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} responding />)

    expect(screen.queryByRole('button', { name: /Thinking/ })).not.toBeInTheDocument()
    expect(screen.getByText('direct answer')).toBeInTheDocument()
  })

  it('should omit the activity disclosure for a completed response without activity', () => {
    const item = {
      id: 'answer-without-activity',
      content: 'final answer',
      isAnswer: true,
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} content={item.content} />)

    expect(screen.queryByRole('button', { name: /Thinking/ })).not.toBeInTheDocument()
    expect(screen.getByText('final answer')).toBeInTheDocument()
  })

  it('should keep the completed thinking label and render the final answer outside it', async () => {
    const user = userEvent.setup()
    const item = {
      id: 'answer-complete',
      content: 'final answer',
      isAnswer: true,
      more: {
        time: '',
        tokens: 0,
        latency: 66,
      },
      agent_thoughts: [
        {
          id: 'thought-complete',
          thought: 'raw process detail',
          tool: 'shell_run',
          tool_input: '{"command":"ls"}',
          tool_labels: {
            shell_run: {
              en_US: 'Ran commands',
              zh_Hans: '运行了命令',
            },
          },
          observation: 'README.md',
          message_id: 'answer-complete',
          conversation_id: 'conversation-complete',
          position: 1,
        },
      ],
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} content={item.content} />)

    const processToggle = screen.getByRole('button', {
      name: 'Thinking · {{count}}m{{count}}s',
    })
    expect(processToggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('raw process detail')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ran commands' })).not.toBeInTheDocument()
    expect(screen.getByText('final answer')).toBeInTheDocument()

    await user.click(processToggle)

    expect(processToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Ran commands' })).toBeInTheDocument()
    expect(screen.getByText('final answer')).toBeInTheDocument()
  })
})
