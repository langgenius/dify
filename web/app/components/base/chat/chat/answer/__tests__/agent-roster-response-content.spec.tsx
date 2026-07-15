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
              terminal: {
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
            tool: 'terminal',
            tool_input: '',
            tool_labels: {
              load_tools: {
                en_US: 'Loaded tools',
                zh_Hans: '已加载工具',
              },
              terminal: {
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
    expect(processToggle).toHaveAttribute('aria-expanded', 'false')

    await user.click(processToggle)

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
          tool: 'terminal',
          tool_input: '{"command":"ls"}',
          tool_labels: {
            terminal: {
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
    expect(activityToggle).toHaveClass('h-6', 'w-auto', 'p-1', 'system-xs-medium')
    expect(activityToggle).not.toHaveClass('w-full')

    await user.click(activityToggle)

    expect(activityToggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Ran commands' })).toBe(activityToggle)
    expect(screen.getByText('{"command":"ls"}')).toBeInTheDocument()

    const detailsId = activityToggle.getAttribute('aria-controls')
    const details = detailsId ? document.getElementById(detailsId) : null
    expect(details).toHaveClass('w-full', 'max-w-full')
    expect(details?.firstElementChild).toHaveClass('w-full', 'min-w-0', 'max-w-full')
    expect(details?.firstElementChild).not.toHaveClass('pl-6')
    expect(screen.getByText('{"command":"ls"}')).toHaveClass(
      'min-w-0',
      'max-w-full',
      'whitespace-pre-wrap',
      'wrap-break-word',
    )
  })

  it('should collapse the thinking timeline when a public message appears', () => {
    const item = {
      id: 'answer-transition',
      content: '',
      isAnswer: true,
      agent_response_parts: [
        {
          type: 'thought',
          thought: {
            id: 'thought-transition',
            thought: 'raw thinking',
            tool: 'terminal',
            tool_input: '{"command":"ls"}',
            tool_labels: {
              terminal: {
                en_US: 'Ran commands',
                zh_Hans: '运行了命令',
              },
            },
            observation: 'README.md',
            message_id: 'answer-transition',
            conversation_id: 'conversation-transition',
            position: 1,
          },
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
      'false',
    )

    rerender(<AgentRosterResponseContent item={itemWithMessage} responding={false} />)

    expect(screen.getByRole('button', { name: 'Thinking' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
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
          tool: 'terminal',
          tool_input: '{"command":"ls"}',
          tool_labels: {
            terminal: {
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
