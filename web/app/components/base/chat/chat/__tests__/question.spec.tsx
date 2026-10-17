import type { Theme } from '../../embedded-chatbot/theme/theme'
import type { ChatConfig, ChatItem, OnRegenerate } from '../../types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { ChatContextProvider } from '../context-provider'
import Question from '../question'

const mockCopy = vi.fn()

vi.mock('foxact/use-clipboard', () => ({
  useClipboard: () => ({
    copy: mockCopy,
    copied: false,
  }),
}))
type RenderProps = {
  theme?: Theme | null
  questionIcon?: React.ReactNode
  enableEdit?: boolean
  switchSibling?: (siblingMessageId: string) => void
  hideAvatar?: boolean
  answerIcon?: React.ReactNode
}

const makeItem = (overrides: Partial<ChatItem> = {}): ChatItem =>
  ({
    id: 'q-1',
    content: 'This is the question content',
    message_files: [],
    siblingCount: 3,
    siblingIndex: 0,
    prevSibling: null,
    nextSibling: 'q-2',
    ...overrides,
  }) as unknown as ChatItem

const renderWithProvider = (
  item: ChatItem,
  onRegenerate: OnRegenerate = vi.fn() as unknown as OnRegenerate,
  props: RenderProps = {},
) => {
  return render(
    <ChatContextProvider
      config={{} as unknown as ChatConfig | undefined}
      isResponding={false}
      chatList={[]}
      questionIcon={props.questionIcon}
      answerIcon={props.answerIcon}
      onSend={vi.fn()}
      onRegenerate={onRegenerate}
      onAnnotationEdited={vi.fn()}
      onAnnotationAdded={vi.fn()}
      onAnnotationRemoved={vi.fn()}
      disableFeedback={false}
      onFeedback={vi.fn()}
      getHumanInputNodeData={vi.fn()}
    >
      <Question
        item={item}
        theme={props.theme}
        questionIcon={props.questionIcon}
        enableEdit={props.enableEdit}
        switchSibling={props.switchSibling}
        hideAvatar={props.hideAvatar}
      />
    </ChatContextProvider>,
  )
}

describe('Question component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([false, true])('shows a supplied avatar unless hidden=%s', async (hideAvatar) => {
    renderWithProvider(makeItem(), vi.fn(), {
      questionIcon: <span aria-label="Your avatar" role="img" />,
      hideAvatar,
    })
    expect(await screen.findByText('This is the question content')).toBeInTheDocument()
    if (hideAvatar)
      expect(screen.queryByRole('img', { name: 'Your avatar' })).not.toBeInTheDocument()
    else expect(screen.getByRole('img', { name: 'Your avatar' })).toBeInTheDocument()
  })

  it('should copy the question content when copy action is clicked', async () => {
    const user = userEvent.setup()

    renderWithProvider(makeItem())

    const copyBtn = screen.getByRole('button', { name: 'common.operation.copy' })
    await user.click(copyBtn)

    expect(mockCopy).toHaveBeenCalledWith('This is the question content')
  })

  it('should not show edit action when enableEdit is false', () => {
    renderWithProvider(makeItem(), vi.fn() as unknown as OnRegenerate, { enableEdit: false })

    expect(screen.getByRole('button', { name: 'common.operation.copy' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  })

  it('should enter edit mode when edit action clicked, allow editing and call onRegenerate on resend', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate

    const item = makeItem()
    renderWithProvider(item, onRegenerate)

    const editBtn = screen.getByRole('button', { name: 'common.operation.edit' })
    await user.click(editBtn)

    const textbox = await screen.findByRole('textbox')
    expect(textbox).toHaveValue('This is the question content')

    await user.clear(textbox)
    await user.type(textbox, 'Edited question')

    const resendBtn = screen.getByRole('button', { name: /operation.save/i })
    await user.click(resendBtn)

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith(item, { message: 'Edited question', files: [] })
    })
  })

  it('should cancel editing and revert to original markdown when cancel is clicked', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn()
    renderWithProvider(makeItem(), onRegenerate)

    const editBtn = screen.getByRole('button', { name: 'common.operation.edit' })
    await user.click(editBtn)

    const textbox = await screen.findByRole('textbox')
    await user.clear(textbox)
    await user.type(textbox, 'Edited question')

    const cancelBtn = await screen.findByRole('button', { name: 'common.operation.cancel' })
    await user.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText('This is the question content')).toBeInTheDocument()
    })
    expect(onRegenerate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByRole('textbox')).toHaveValue('This is the question content')
  })

  it('should confirm editing when Enter is pressed', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate

    renderWithProvider(makeItem(), onRegenerate)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const textbox = await screen.findByRole('textbox')

    await user.clear(textbox)
    await user.type(textbox, 'Edited with Enter')

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith(makeItem(), {
        message: 'Edited with Enter',
        files: [],
      })
    })
  })

  it('should insert a new line when Shift+Enter is pressed', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate

    renderWithProvider(makeItem(), onRegenerate)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const textbox = await screen.findByRole('textbox')

    await user.clear(textbox)
    await user.type(textbox, 'Line 1')
    await user.type(textbox, '{Shift>}{Enter}{/Shift}')

    expect(textbox).toHaveValue('Line 1\n')
    expect(onRegenerate).not.toHaveBeenCalled()
  })

  it('should keep text unchanged and suppress Enter if a new composition starts before previous composition-end timer finishes', async () => {
    vi.useFakeTimers()

    try {
      const onRegenerate = vi.fn() as unknown as OnRegenerate
      renderWithProvider(makeItem(), onRegenerate)

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.edit' }))
      const textbox = screen.getByRole('textbox')
      fireEvent.change(textbox, { target: { value: 'IME guard text' } })

      fireEvent.compositionStart(textbox)
      fireEvent.compositionEnd(textbox)
      fireEvent.compositionStart(textbox)

      act(() => vi.advanceTimersByTime(50))

      const blockedEnterEvent = new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        bubbles: true,
        cancelable: true,
      })
      fireEvent(textbox, blockedEnterEvent)
      expect(onRegenerate).not.toHaveBeenCalled()
      expect(blockedEnterEvent.defaultPrevented).toBe(true)
      expect(textbox).toHaveValue('IME guard text')

      fireEvent.compositionEnd(textbox)
      act(() => vi.advanceTimersByTime(50))

      fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })
      expect(onRegenerate).toHaveBeenCalledWith(makeItem(), {
        message: 'IME guard text',
        files: [],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('should switch siblings when prev/next buttons are clicked', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    const item = makeItem({ prevSibling: 'q-prev', nextSibling: 'q-next', siblingIndex: 1 })

    renderWithProvider(item, vi.fn() as unknown as OnRegenerate, { switchSibling })

    const prevBtn = screen.getByRole('button', { name: /previous/i })
    const nextBtn = screen.getByRole('button', { name: /next/i })

    await user.click(prevBtn)
    await user.click(nextBtn)

    expect(switchSibling).toHaveBeenCalledTimes(2)
    expect(switchSibling).toHaveBeenCalledWith('q-prev')
    expect(switchSibling).toHaveBeenCalledWith('q-next')
  })

  it('should ignore enter when nativeEvent.isComposing is true', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate
    renderWithProvider(makeItem(), onRegenerate)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const textbox = await screen.findByRole('textbox')

    // Create an event with nativeEvent.isComposing = true
    const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    Object.defineProperty(event, 'isComposing', { value: true, configurable: true })

    fireEvent(textbox, event)
    expect(onRegenerate).not.toHaveBeenCalled()
  })

  it('should not call switchSibling when next button clicked but nextSibling is null', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    const item = makeItem({
      prevSibling: 'q-0',
      nextSibling: undefined,
      siblingIndex: 2,
      siblingCount: 3,
    })

    renderWithProvider(item, vi.fn() as unknown as OnRegenerate, { switchSibling })

    const nextBtn = screen.getByRole('button', { name: /next/i })
    await user.click(nextBtn)

    expect(switchSibling).not.toHaveBeenCalled()
    expect(nextBtn).toBeDisabled()
  })

  it('should not call switchSibling when prev button clicked but prevSibling is null', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    const item = makeItem({
      prevSibling: undefined,
      nextSibling: 'q-2',
      siblingIndex: 0,
      siblingCount: 3,
    })

    renderWithProvider(item, vi.fn() as unknown as OnRegenerate, { switchSibling })

    const prevBtn = screen.getByRole('button', { name: /previous/i })
    await user.click(prevBtn)

    expect(switchSibling).not.toHaveBeenCalled()
    expect(prevBtn).toBeDisabled()
  })

  it('should handle both prev and next siblings being null (only one message)', () => {
    const item = makeItem({
      prevSibling: undefined,
      nextSibling: undefined,
      siblingIndex: 0,
      siblingCount: 1,
    })
    renderWithProvider(item, vi.fn() as unknown as OnRegenerate)

    const prevBtn = screen.queryByRole('button', { name: /previous/i })
    const nextBtn = screen.queryByRole('button', { name: /next/i })

    expect(prevBtn).not.toBeInTheDocument()
    expect(nextBtn).not.toBeInTheDocument()
  })

  it('should render with message_files having multiple files', () => {
    const files = [
      {
        name: 'document.pdf',
        url: 'https://example.com/doc.pdf',
        type: 'application/pdf',
        previewUrl: 'https://example.com/doc.pdf',
        size: 5000,
      } as unknown as FileEntity,
      {
        name: 'image.png',
        url: 'https://example.com/img.png',
        type: 'image/png',
        previewUrl: 'https://example.com/img.png',
        size: 3000,
      } as unknown as FileEntity,
    ]

    renderWithProvider(makeItem({ message_files: files }))

    expect(screen.getByText(/document.pdf/i)).toBeInTheDocument()
    expect(screen.getByText(/image.png/i)).toBeInTheDocument()
  })

  it('should trigger onRegenerate with actual message_files in item', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate
    const files = [
      {
        name: 'edit-file.txt',
        url: 'https://example.com/edit-file.txt',
        type: 'text/plain',
        previewUrl: 'https://example.com/edit-file.txt',
        size: 200,
      } as unknown as FileEntity,
    ]

    const item = makeItem({ message_files: files })
    renderWithProvider(item, onRegenerate)
    expect(screen.getByText('edit-file.txt')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    const textbox = await screen.findByRole('textbox')

    await user.clear(textbox)
    await user.type(textbox, 'Modified with files')
    expect(screen.getByText('edit-file.txt')).toBeInTheDocument()

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith(item, { message: 'Modified with files', files })
    })
  })
})
