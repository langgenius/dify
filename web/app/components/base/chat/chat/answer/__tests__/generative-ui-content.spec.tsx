import type { OpenUiContentBlock as OpenUIContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { ChatItem } from '../../../types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { toast } from '@/app/notifications'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { ChatContextProvider } from '../../context-provider'
import Answer from '../index'

const block: OpenUIContentBlock = {
  id: 'ui-1',
  type: 'openui',
  library_version: 'dify-ui-v1',
  text_offset: 0,
  source:
    'root = Stack([filters])\nfilters = Form("filters", "Filter results", "Apply", "Apply filters", [region])\nregion = TextField("region", "Region", "East", false)',
  sequence: 2,
  status: 'completed',
  form_state: {},
}

const item: ChatItem = { id: 'message-1', isAnswer: true, content: '', content_blocks: [block] }

describe('OpenUI content in shared answers', () => {
  beforeAll(async () => {
    await import('@/features/generative-ui/renderer')
    await import('@/app/components/base/markdown/streamdown-wrapper')
  }, 30_000)

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends form values as a new conversation turn without submitting a Human Input form', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onHumanInputFormSubmit = vi.fn()
    renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={onSend}>
        <Answer
          item={{
            ...item,
            humanInputFormDataList: [
              {
                form_id: 'approval',
                node_id: 'review',
                node_title: 'Review',
                form_content: 'Review this request',
                inputs: [],
                actions: [
                  { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
                ],
                form_token: 'approval-token',
                resolved_default_values: {},
                display_in_ui: true,
                expiration_time: null,
              },
            ],
          }}
          question="Choose filters"
          index={0}
          onHumanInputFormSubmit={onHumanInputFormSubmit}
        />
      </ChatContextProvider>,
    )

    const field = await screen.findByRole('textbox', { name: 'Region' })
    await user.clear(field)
    await user.type(field, 'West')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onSend).toHaveBeenCalledExactlyOnceWith('Apply filters\n\nregion: West')
    expect(onHumanInputFormSubmit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onHumanInputFormSubmit).toHaveBeenCalledExactlyOnceWith('approval-token', {
      inputs: {},
      action: 'approve',
    })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it.each(['streaming', 'cancelled', 'error'] as const)(
    'disables interactions for a %s block',
    async (status) => {
      renderWithConsoleQuery(
        <ChatContextProvider chatList={[item]} onSend={vi.fn()}>
          <Answer
            item={{ ...item, content_blocks: [{ ...block, status }] }}
            question="Choose filters"
            index={0}
          />
        </ChatContextProvider>,
      )
      expect(await screen.findByRole('button', { name: 'Apply' })).toBeDisabled()
      expect(screen.getByRole('textbox', { name: 'Region' })).toBeDisabled()
    },
  )

  it('serializes and coalesces form state saves for one message block', async () => {
    const user = userEvent.setup()
    let finishFirstSave: () => void = () => undefined
    const firstSave = new Promise<void>((resolve) => {
      finishFirstSave = resolve
    })
    const saveState = vi.fn().mockReturnValueOnce(firstSave).mockResolvedValue(undefined)
    renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={vi.fn()} onGenerativeUIStateChange={saveState}>
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Region' })
    await user.clear(input)
    await waitFor(() => expect(saveState).toHaveBeenCalledTimes(1))
    await user.type(input, 'West')
    // The second request must wait until the first one settles.
    expect(saveState).toHaveBeenCalledTimes(1)
    await act(async () => {
      finishFirstSave()
    })
    await waitFor(() =>
      expect(saveState).toHaveBeenLastCalledWith(
        'message-1',
        'ui-1',
        expect.objectContaining({
          filters: expect.objectContaining({ region: expect.objectContaining({ value: 'West' }) }),
        }),
      ),
    )
  })

  it('debounces edits and skips duplicate SDK updates and unchanged saved values', async () => {
    const saveState = vi.fn().mockResolvedValue(undefined)
    renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={vi.fn()} onGenerativeUIStateChange={saveState}>
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Region' })
    vi.useFakeTimers()
    // RTL uses this bridge to drain userEvent's zero-delay async wrapper.
    vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.clear(input)
    await user.type(input, 'West')
    await act(async () => vi.advanceTimersByTimeAsync(249))
    expect(saveState).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(saveState).toHaveBeenCalledExactlyOnceWith(
      'message-1',
      'ui-1',
      expect.objectContaining({
        filters: expect.objectContaining({ region: expect.objectContaining({ value: 'West' }) }),
      }),
    )
    await user.clear(input)
    await user.type(input, 'West')
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(saveState).toHaveBeenCalledTimes(1)
  })

  it('flushes the latest form state before sending and blocks duplicate submissions', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    let finishSave: () => void = () => undefined
    const saveState = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve
      }),
    )
    renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={onSend} onGenerativeUIStateChange={saveState}>
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Region' })
    await user.clear(input)
    await user.type(input, 'West')
    const submit = screen.getByRole('button', { name: 'Apply' })
    await user.click(submit)
    expect(saveState).toHaveBeenCalledExactlyOnceWith(
      'message-1',
      'ui-1',
      expect.objectContaining({
        filters: expect.objectContaining({ region: expect.objectContaining({ value: 'West' }) }),
      }),
    )
    expect(submit).toBeDisabled()
    expect(input).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
    await user.click(submit)
    await act(async () => finishSave())
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Apply filters\n\nregion: West')
  })

  it('retains a failed save so the user can retry submitting without another edit', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const saveState = vi
      .fn()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(undefined)
    const showError = vi.spyOn(toast, 'error').mockImplementation(() => 'save-error')
    renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={onSend} onGenerativeUIStateChange={saveState}>
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Region' })
    await user.clear(input)
    await user.type(input, 'West')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(showError).toHaveBeenCalledTimes(1))
    expect(onSend).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledExactlyOnceWith('Apply filters\n\nregion: West'),
    )
    expect(saveState).toHaveBeenCalledTimes(2)
    showError.mockRestore()
  })

  it('flushes a pending draft to its original message when the displayed message changes', async () => {
    const saveState = vi.fn().mockResolvedValue(undefined)
    const onSend = vi.fn()
    const { rerender, unmount } = renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={onSend} onGenerativeUIStateChange={saveState}>
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Region' })
    vi.useFakeTimers()
    // RTL uses this bridge to drain userEvent's zero-delay async wrapper.
    vi.stubGlobal('jest', { advanceTimersByTime: vi.advanceTimersByTime })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.clear(input)
    await user.type(input, 'West')
    const nextItem = { ...item, id: 'message-2' }
    rerender(
      <ChatContextProvider
        chatList={[nextItem]}
        onSend={onSend}
        onGenerativeUIStateChange={saveState}
      >
        <Answer item={nextItem} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    expect(saveState).toHaveBeenCalledExactlyOnceWith(
      'message-1',
      'ui-1',
      expect.objectContaining({
        filters: expect.objectContaining({ region: expect.objectContaining({ value: 'West' }) }),
      }),
    )
    expect(screen.getByRole('textbox', { name: 'Region' })).toHaveValue('East')
    await user.type(screen.getByRole('textbox', { name: 'Region' }), 'ern')
    unmount()
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(saveState).toHaveBeenCalledTimes(2)
    expect(saveState).toHaveBeenLastCalledWith(
      'message-2',
      'ui-1',
      expect.objectContaining({
        filters: expect.objectContaining({ region: expect.objectContaining({ value: 'Eastern' }) }),
      }),
    )
  })

  it('does not send a pending submission after leaving its message', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    let finishSave: () => void = () => undefined
    const saveState = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve
      }),
    )
    const { unmount } = renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={onSend} onGenerativeUIStateChange={saveState}>
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Region' })
    await user.type(input, 'ern')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    unmount()
    await act(async () => finishSave())
    expect(saveState).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('does not send a pending submission after the host disables input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    let finishSave: () => void = () => undefined
    const saveState = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve
      }),
    )
    const { rerender } = renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={onSend} onGenerativeUIStateChange={saveState}>
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Region' })
    await user.type(input, 'ern')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    rerender(
      <ChatContextProvider
        chatList={[item]}
        onSend={onSend}
        onGenerativeUIStateChange={saveState}
        inputDisabled
      >
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    await act(async () => finishSave())
    expect(saveState).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('uses the current host callbacks after chat updates and a pending save', async () => {
    const user = userEvent.setup()
    const originalSend = vi.fn()
    const originalSave = vi.fn().mockResolvedValue(undefined)
    const nextSend = vi.fn()
    let finishSave: () => void = () => undefined
    const nextSave = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve
      }),
    )
    const { rerender } = renderWithConsoleQuery(
      <ChatContextProvider
        chatList={[item]}
        onSend={originalSend}
        onGenerativeUIStateChange={originalSave}
      >
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Region' })
    const updatedChatList = [item, { id: 'message-2', isAnswer: true, content: 'Another response' }]
    rerender(
      <ChatContextProvider
        chatList={updatedChatList}
        onSend={nextSend}
        onGenerativeUIStateChange={nextSave}
      >
        <Answer item={{ ...item }} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    await user.type(input, 'ern')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(originalSave).not.toHaveBeenCalled()
    expect(nextSave).toHaveBeenCalledExactlyOnceWith(
      'message-1',
      'ui-1',
      expect.objectContaining({
        filters: expect.objectContaining({ region: expect.objectContaining({ value: 'Eastern' }) }),
      }),
    )

    const latestSend = vi.fn()
    rerender(
      <ChatContextProvider
        chatList={updatedChatList}
        onSend={latestSend}
        onGenerativeUIStateChange={nextSave}
      >
        <Answer item={{ ...item }} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    await act(async () => finishSave())

    expect(input).toHaveValue('Eastern')
    expect(originalSend).not.toHaveBeenCalled()
    expect(nextSend).not.toHaveBeenCalled()
    expect(latestSend).toHaveBeenCalledExactlyOnceWith('Apply filters\n\nregion: Eastern')
  })

  it('preserves the draft while another response temporarily disables interactions', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const { rerender } = renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={onSend}>
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const input = await screen.findByRole('textbox', { name: 'Region' })
    await user.type(input, 'ern')
    rerender(
      <ChatContextProvider chatList={[item]} onSend={onSend} isResponding>
        <Answer item={{ ...item }} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    expect(input).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()

    rerender(
      <ChatContextProvider chatList={[item]} onSend={onSend} isResponding={false}>
        <Answer item={{ ...item }} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    expect(input).toBeEnabled()
    expect(input).toHaveValue('Eastern')
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onSend).toHaveBeenCalledExactlyOnceWith('Apply filters\n\nregion: Eastern')
  })

  it('does not send a turn when the host disables chat input', async () => {
    const onSend = vi.fn()
    const user = userEvent.setup()
    renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={onSend} inputDisabled>
        <Answer item={item} question="Choose filters" index={0} />
      </ChatContextProvider>,
    )
    const button = await screen.findByRole('button', { name: 'Apply' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('rehydrates stored form state in a completed message', async () => {
    renderWithConsoleQuery(
      <ChatContextProvider chatList={[item]} onSend={vi.fn()}>
        <Answer
          item={{
            ...item,
            content_blocks: [{ ...block, form_state: { filters: { region: { value: 'West' } } } }],
          }}
          question="Choose filters"
          index={0}
        />
      </ChatContextProvider>,
    )
    expect(await screen.findByRole('textbox', { name: 'Region' })).toHaveValue('West')
  })
})
