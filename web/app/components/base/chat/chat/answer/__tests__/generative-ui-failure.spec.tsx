import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { ChatItem } from '../../../types'
import type { GenerativeUIRendererProps } from '@/features/generative-ui/renderer'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ChatContextProvider } from '../../context-provider'
import Answer from '../index'

const failureSources = vi.hoisted(() => ({
  runtime: 'root = Stack([Text("A card whose renderer fails")])',
  load: 'root = Stack([Text("A card whose module fails to load")])',
}))

// Inject failures at the renderer boundary; healthy blocks, chat, and the error boundary stay real.
vi.mock('@/features/generative-ui/renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/generative-ui/renderer')>()
  const { lazy, Suspense } = await import('react')
  const UnavailableRenderer = lazy(async () => {
    throw new TypeError('Failed to fetch dynamically imported module')
  })
  return {
    ...actual,
    GenerativeUIRenderer: (props: GenerativeUIRendererProps) => {
      if (props.source === failureSources.runtime) throw new Error('Generated component failed')
      if (props.source === failureSources.load) {
        return (
          <Suspense fallback={null}>
            <UnavailableRenderer />
          </Suspense>
        )
      }
      return <actual.GenerativeUIRenderer {...props} />
    },
  }
})

function makeBlock(id: string, source: string): OpenUIContentBlock {
  return {
    id,
    type: 'openui',
    library_version: 'dify-ui-v1',
    text_offset: 0,
    source,
    sequence: 1,
    status: 'completed',
    form_state: {},
  }
}

describe('Generative UI failure isolation', () => {
  beforeAll(async () => {
    // Finish transforming the real SDK and controls before timing UI assertions.
    await import('@/features/generative-ui/renderer')
  }, 30_000)

  it.each(['runtime', 'load'] as const)(
    'preserves the answer and another interactive block after a %s failure',
    async (failure) => {
      const user = userEvent.setup()
      const onSend = vi.fn()
      const onCaughtError = vi.fn()
      const content = 'Sales total 2.6 million across 65 orders.'
      const item: ChatItem = {
        id: 'message-1',
        isAnswer: true,
        content,
        content_blocks: [
          makeBlock('broken', failureSources[failure]),
          makeBlock(
            'healthy',
            'root = Stack([ActionButton("View details", "Show sales details")])',
          ),
        ],
      }
      renderWithConsoleQuery(
        <ChatContextProvider chatList={[item]} onSend={onSend}>
          <Answer item={item} question="Show sales" index={0} />
        </ChatContextProvider>,
        { onCaughtError },
      )

      const details = await screen.findByRole('button', { name: 'View details' })
      await waitFor(() => expect(onCaughtError).toHaveBeenCalled())
      await user.click(details)
      expect(onSend).toHaveBeenCalledExactlyOnceWith('Show sales details')
      expect(await screen.findByText(content)).toBeVisible()
      expect(screen.getByText('appDebug.generativeUI.unavailable')).toBeVisible()
      expect(screen.queryByText('A card whose renderer fails')).not.toBeInTheDocument()
      expect(screen.queryByText('A card whose module fails to load')).not.toBeInTheDocument()
    },
  )

  it('shows the answer once when multiple UI blocks fail in the human-input layout', async () => {
    const content = 'The review is complete. Sales total 2.6 million.'
    const item: ChatItem = {
      id: 'message-1',
      isAnswer: true,
      content,
      humanInputFilledFormDataList: [
        {
          form_id: 'review-form',
          node_id: 'review-node',
          node_title: 'Review request',
          rendered_content: 'Approved response',
          action_id: 'approve',
          action_text: 'Approved',
        },
      ],
      content_blocks: [
        makeBlock('unknown-component', 'root = Unknown("broken")'),
        makeBlock('missing-reference', 'root = Stack([missing])'),
      ],
    }
    renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]}>
        <Answer item={item} question="Show sales" index={0} />
      </ChatContextProvider>,
    )

    await waitFor(() => {
      const failures = screen.getAllByText('appDebug.generativeUI.unavailable')
      expect(failures).toHaveLength(2)
      for (const failure of failures) expect(failure).toBeVisible()
    })
    expect(await screen.findByText(content)).toBeVisible()
  })

  it('shows a readable fallback without answer text and recovers when the source is replaced', async () => {
    const onSend = vi.fn()
    const onCaughtError = vi.fn()
    const item: ChatItem = {
      id: 'message-1',
      isAnswer: true,
      content: '',
      content_blocks: [makeBlock('broken', failureSources.runtime)],
    }
    const { rerender } = renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={onSend}>
        <Answer item={item} question="Show sales" index={0} />
      </ChatContextProvider>,
      { onCaughtError },
    )
    expect(await screen.findByText('appDebug.generativeUI.unavailable')).toBeVisible()

    const recoveredItem: ChatItem = {
      ...item,
      content_blocks: [makeBlock('broken', 'root = Stack([Heading("Sales recovered")])')],
    }
    rerender(
      <ChatContextProvider chatList={[recoveredItem]} onSend={onSend}>
        <Answer item={recoveredItem} question="Show sales" index={0} />
      </ChatContextProvider>,
    )
    expect(await screen.findByRole('heading', { name: 'Sales recovered' })).toBeVisible()
    expect(screen.queryByText('appDebug.generativeUI.unavailable')).not.toBeInTheDocument()
  })
})
