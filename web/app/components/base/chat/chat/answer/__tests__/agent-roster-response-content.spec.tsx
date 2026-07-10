import type { ChatItem } from '../../../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { AgentRosterResponseContent } from '../agent-roster-response-content'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  const { createReactI18nextMock } = await import('../../../../../../../test/i18n-mock')
  return {
    ...actual,
    ...createReactI18nextMock({
      'common.chat.thought': 'Thought',
    }),
  }
})

describe('AgentRosterResponseContent', () => {
  it('should render historical agent thought answer as markdown instead of thought process', async () => {
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

    expect(screen.getByRole('button', { name: /workFinished/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('agent-roster-response-content')).toHaveTextContent('history answer')
    })

    fireEvent.click(screen.getByRole('button', { name: /workFinished/i }))

    await waitFor(() => {
      expect(screen.getByTestId('agent-roster-response-content')).toHaveTextContent('history answer')
    })

    expect(screen.queryByText('internal thought should not render')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('agent-content-markdown')).toHaveLength(1)
  })

  it('should render new agent response parts in event order when thoughts and messages interleave', async () => {
    const item = {
      id: 'answer-1',
      content: 'first answer second answer',
      isAnswer: true,
      agent_thoughts: [
        {
          id: 'thought-1',
          thought: 'first thought',
          tool: '',
          tool_input: '',
          observation: '',
          message_id: 'answer-1',
          conversation_id: 'conversation-1',
          position: 1,
        },
        {
          id: 'thought-2',
          thought: 'second thought',
          tool: '',
          tool_input: '',
          observation: '',
          message_id: 'answer-1',
          conversation_id: 'conversation-1',
          position: 2,
        },
      ],
      agent_response_parts: [
        {
          type: 'thought',
          thought: {
            id: 'thought-1',
            thought: 'first thought',
            tool: '',
            tool_input: '',
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
            thought: 'second thought',
            tool: '',
            tool_input: '',
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

    await waitFor(() => {
      expect(screen.getByTestId('agent-roster-response-content')).toHaveTextContent('second answer')
    })

    const content = screen.getByTestId('agent-roster-response-content').textContent ?? ''
    expect(content.indexOf('first thought')).toBeLessThan(content.indexOf('first answer'))
    expect(content.indexOf('first answer')).toBeLessThan(content.indexOf('second thought'))
    expect(content.indexOf('second thought')).toBeLessThan(content.indexOf('second answer'))
  })

  it('should show THOUGHT as the header when a thought process is expanded', () => {
    const item = {
      id: 'answer-expanded-thought',
      content: '',
      isAnswer: true,
      agent_thoughts: [
        {
          id: 'thought-expanded',
          thought: 'visible thought summary',
          tool: '',
          tool_input: '',
          observation: '',
          message_id: 'answer-expanded-thought',
          conversation_id: 'conversation-expanded-thought',
          position: 1,
        },
      ],
    } satisfies ChatItem

    render(<AgentRosterResponseContent item={item} responding />)

    expect(screen.getByRole('button', { name: 'THOUGHT' })).toBeInTheDocument()
  })
})
