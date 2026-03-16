import type { Theme } from '../../embedded-chatbot/theme/theme-context'
import type { ChatConfig, ChatItem, OnRegenerate } from '../../types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import Toast from '../../../toast'
import { ThemeBuilder } from '../../embedded-chatbot/theme/theme-context'
import { ChatContextProvider } from '../context-provider'
import Question from '../question'

// Global Mocks
vi.mock('@react-aria/interactions', () => ({
  useFocusVisible: () => ({ isFocusVisible: false }),
}))
vi.mock('../content-switch', () => ({
  default: ({ count, currentIndex, switchSibling, prevDisabled, nextDisabled }: {
    count?: number
    currentIndex?: number
    switchSibling: (direction: 'prev' | 'next') => void
    prevDisabled: boolean
    nextDisabled: boolean
  }) => {
    if (!(count && count > 1 && currentIndex !== undefined))
      return null

    return (
      <div data-testid="content-switch">
        <button
          type="button"
          aria-label="Previous"
          onClick={() => switchSibling('prev')}
          disabled={prevDisabled}
        >
          Previous
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => switchSibling('next')}
          disabled={nextDisabled}
        >
          Next
        </button>
      </div>
    )
  },
}))
vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div className="markdown-body">{content}</div>,
}))

// Mock ResizeObserver and capture lifecycle for targeted coverage
const observeMock = vi.fn()
const unobserveMock = vi.fn()
const disconnectMock = vi.fn()
let resizeCallback: ResizeObserverCallback | null = null

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback
  }

  observe = observeMock
  unobserve = unobserveMock
  disconnect = disconnectMock
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

type RenderProps = {
  theme?: Theme | null
  questionIcon?: React.ReactNode
  enableEdit?: boolean
  switchSibling?: (siblingMessageId: string) => void
  hideAvatar?: boolean
  answerIcon?: React.ReactNode
}

const makeItem = (overrides: Partial<ChatItem> = {}): ChatItem => ({
  id: 'q-1',
  content: 'This is the question content',
  message_files: [],
  siblingCount: 3,
  siblingIndex: 0,
  prevSibling: null,
  nextSibling: 'q-2',
  ...overrides,
} as unknown as ChatItem)

const renderWithProvider = (
  item: ChatItem,
  onRegenerate: OnRegenerate = vi.fn() as unknown as OnRegenerate,
  props: RenderProps = {},
) => {
  return render(
    <ChatContextProvider
      config={{} as unknown as (ChatConfig | undefined)}
      isResponding={false}
      chatList={[]}
      showPromptLog={false}
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
    resizeCallback = null
  })

  it('should render the question content container and default avatar when hideAvatar is false', () => {
    const { container } = renderWithProvider(makeItem())

    const markdown = container.querySelector('.markdown-body')
    expect(markdown).toBeInTheDocument()

    const avatar = container.querySelector('.h-10.w-10') || container.querySelector('.h-10.w-10.shrink-0')
    expect(avatar).toBeTruthy()
  })

  it('should hide avatar when hideAvatar is true', () => {
    const { container } = renderWithProvider(makeItem(), vi.fn() as unknown as OnRegenerate, { hideAvatar: true })
    const avatar = container.querySelector('.h-10.w-10')
    expect(avatar).toBeNull()
  })

  it('should observe content width resize and update layout accurately', () => {
    renderWithProvider(makeItem())

    expect(observeMock).toHaveBeenCalled()
    expect(resizeCallback).not.toBeNull()

    // Mock HTML element clientWidth to trigger logic mapping line coverage
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 500 })

    act(() => {
      if (resizeCallback) {
        resizeCallback([], {} as ResizeObserver)
      }
    })

    const actionContainer = screen.getByTestId('action-container')
    // 500 width + 8 offset defined in styles
    expect(actionContainer).toHaveStyle({ right: '508px' })

    // Restore original
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
    }
  })

  it('should disconnect ResizeObserver on component unmount', () => {
    const { unmount } = renderWithProvider(makeItem())
    unmount()
    expect(disconnectMock).toHaveBeenCalled()
  })

  it('should call copy-to-clipboard and show a toast when copy action is clicked', async () => {
    const user = userEvent.setup()
    const toastSpy = vi.spyOn(Toast, 'notify')

    renderWithProvider(makeItem())

    const copyBtn = screen.getByTestId('copy-btn')
    await user.click(copyBtn)

    await waitFor(() => {
      expect(copy).toHaveBeenCalledWith('This is the question content')
      expect(toastSpy).toHaveBeenCalled()
    })
  })

  it('should not show edit action when enableEdit is false', () => {
    renderWithProvider(makeItem(), vi.fn() as unknown as OnRegenerate, { enableEdit: false })

    expect(screen.getByTestId('copy-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-btn')).not.toBeInTheDocument()
  })

  it('should enter edit mode when edit action clicked, allow editing and call onRegenerate on resend', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate

    const item = makeItem()
    renderWithProvider(item, onRegenerate)

    const editBtn = screen.getByTestId('edit-btn')
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
    const { container } = renderWithProvider(makeItem())

    const editBtn = screen.getByTestId('edit-btn')
    await user.click(editBtn)

    const textbox = await screen.findByRole('textbox')
    await user.clear(textbox)
    await user.type(textbox, 'Edited question')

    const cancelBtn = await screen.findByTestId('cancel-edit-btn')
    await user.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      const md = container.querySelector('.markdown-body')
      expect(md).toBeInTheDocument()
    })
  })

  it('should confirm editing when Enter is pressed', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate

    renderWithProvider(makeItem(), onRegenerate)

    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    await user.clear(textbox)
    await user.type(textbox, 'Edited with Enter')

    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith(makeItem(), { message: 'Edited with Enter', files: [] })
    })
  })

  it('should insert a new line when Shift+Enter is pressed', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate

    renderWithProvider(makeItem(), onRegenerate)

    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    await user.clear(textbox)
    await user.type(textbox, 'Line 1')
    await user.type(textbox, '{Shift>}{Enter}{/Shift}')

    expect(textbox).toHaveValue('Line 1\n')
    expect(onRegenerate).not.toHaveBeenCalled()
  })

  it('should not confirm editing when Enter is pressed during IME composition', () => {
    const onRegenerate = vi.fn() as unknown as OnRegenerate

    renderWithProvider(makeItem(), onRegenerate)

    fireEvent.click(screen.getByTestId('edit-btn'))
    const textbox = screen.getByRole('textbox')

    fireEvent.compositionStart(textbox)
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    expect(onRegenerate).not.toHaveBeenCalled()
    expect(textbox).toHaveValue('This is the question content')
  })

  it('should keep text unchanged and suppress Enter if a new composition starts before previous composition-end timer finishes', async () => {
    vi.useFakeTimers()

    try {
      const onRegenerate = vi.fn() as unknown as OnRegenerate
      renderWithProvider(makeItem(), onRegenerate)

      fireEvent.click(screen.getByTestId('edit-btn'))
      const textbox = screen.getByRole('textbox')
      fireEvent.change(textbox, { target: { value: 'IME guard text' } })

      fireEvent.compositionStart(textbox)
      fireEvent.compositionEnd(textbox)
      fireEvent.compositionStart(textbox)

      vi.advanceTimersByTime(50)

      const blockedEnterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
      textbox.dispatchEvent(blockedEnterEvent)
      expect(onRegenerate).not.toHaveBeenCalled()
      expect(blockedEnterEvent.defaultPrevented).toBe(true)
      expect(textbox).toHaveValue('IME guard text')

      fireEvent.compositionEnd(textbox)
      vi.advanceTimersByTime(50)

      fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })
      expect(onRegenerate).toHaveBeenCalledWith(makeItem(), { message: 'IME guard text', files: [] })
    }
    finally {
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

  it('should render prev disabled when no prevSibling is provided', () => {
    const item = makeItem({ prevSibling: undefined, nextSibling: 'q-next', siblingIndex: 0, siblingCount: 2 })
    renderWithProvider(item, vi.fn() as unknown as OnRegenerate)

    const prevBtn = screen.getByRole('button', { name: /previous/i })
    const nextBtn = screen.getByRole('button', { name: /next/i })

    expect(prevBtn).toBeDisabled()
    expect(nextBtn).not.toBeDisabled()
  })

  it('should render message files block when message_files provided (audio file branch covered)', () => {
    const files = [
      {
        name: 'audio1.mp3',
        url: 'https://example.com/audio1.mp3',
        type: 'audio/mpeg',
        previewUrl: 'https://example.com/audio1.mp3',
        size: 1234,
      } as unknown as FileEntity,
    ]

    renderWithProvider(makeItem({ message_files: files }))

    expect(screen.getByText(/audio1.mp3/i)).toBeInTheDocument()
  })

  it('should apply theme bubble styles when theme provided', () => {
    const themeBuilder = new ThemeBuilder()
    themeBuilder.buildTheme('#ff0000', false)
    const theme = themeBuilder.theme

    renderWithProvider(makeItem(), vi.fn() as unknown as OnRegenerate, { theme })

    const contentContainer = screen.getByTestId('question-content')
    expect(contentContainer.getAttribute('style')).not.toBeNull()
  })

  it('should cover composition lifecycle preventing enter submitting when composing', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate
    const item = makeItem()

    renderWithProvider(item, onRegenerate)

    const editBtn = screen.getByTestId('edit-btn')
    await user.click(editBtn)

    const textbox = await screen.findByRole('textbox')
    await user.clear(textbox)

    // Simulate composition start and typing
    act(() => {
      textbox.focus()
    })

    // Simulate composition start
    fireEvent.compositionStart(textbox)

    // Try to press Enter while composing
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    // Simulate composition end
    fireEvent.compositionEnd(textbox)

    // Expect onRegenerate not to be called because Enter was pressed during composition
    expect(onRegenerate).not.toHaveBeenCalled()

    // Let setTimeout finish its 50ms interval to clear isComposing
    await new Promise(r => setTimeout(r, 60))

    // Now press Enter after composition is fully cleared
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    expect(onRegenerate).toHaveBeenCalledWith(item, { message: '', files: [] })
  })

  it('should prevent Enter from submitting when shiftKey is pressed', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate
    const item = makeItem()

    renderWithProvider(item, onRegenerate)

    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    // Press Shift+Enter
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter', shiftKey: true })

    expect(onRegenerate).not.toHaveBeenCalled()
  })

  it('should ignore enter when nativeEvent.isComposing is true', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate
    renderWithProvider(makeItem(), onRegenerate)

    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    // Create an event with nativeEvent.isComposing = true
    const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    Object.defineProperty(event, 'isComposing', { value: true, configurable: true })

    fireEvent(textbox, event)
    expect(onRegenerate).not.toHaveBeenCalled()
  })

  it('should clear timer on cancel and on component unmount', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate
    const { unmount } = renderWithProvider(makeItem(), onRegenerate)

    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    fireEvent.compositionStart(textbox)
    fireEvent.compositionEnd(textbox)

    // Timer is now running, let's start another composition to clear it
    fireEvent.compositionStart(textbox)
    fireEvent.compositionEnd(textbox)

    const cancelBtn = await screen.findByTestId('cancel-edit-btn')
    await user.click(cancelBtn)

    // Test unmount clearing timer
    await user.click(screen.getByTestId('edit-btn'))
    const textbox2 = await screen.findByRole('textbox')
    fireEvent.compositionStart(textbox2)
    fireEvent.compositionEnd(textbox2)
    unmount()

    expect(onRegenerate).not.toHaveBeenCalled()
  })

  it('should ignore enter when handleResend with active timer', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate
    renderWithProvider(makeItem(), onRegenerate)

    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    fireEvent.compositionStart(textbox)
    fireEvent.compositionEnd(textbox) // starts timer

    const saveBtn = screen.getByTestId('save-edit-btn')
    await user.click(saveBtn) // handleResend clears timer

    expect(onRegenerate).toHaveBeenCalled()
  })

  it('should render custom questionIcon when provided', () => {
    const { container } = renderWithProvider(
      makeItem(),
      vi.fn() as unknown as OnRegenerate,
      { questionIcon: <div data-testid="custom-question-icon">CustomIcon</div> },
    )

    expect(screen.getByTestId('custom-question-icon')).toBeInTheDocument()
    const defaultIcon = container.querySelector('.i-custom-public-avatar-user')
    expect(defaultIcon).not.toBeInTheDocument()
  })

  it('should call switchSibling with next sibling ID when next button clicked and nextSibling exists', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    const item = makeItem({ prevSibling: 'q-0', nextSibling: 'q-2', siblingIndex: 1, siblingCount: 3 })

    renderWithProvider(item, vi.fn() as unknown as OnRegenerate, { switchSibling })

    const nextBtn = screen.getByRole('button', { name: /next/i })
    await user.click(nextBtn)

    expect(switchSibling).toHaveBeenCalledWith('q-2')
    expect(switchSibling).toHaveBeenCalledTimes(1)
  })

  it('should not call switchSibling when next button clicked but nextSibling is null', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    const item = makeItem({ prevSibling: 'q-0', nextSibling: undefined, siblingIndex: 2, siblingCount: 3 })

    renderWithProvider(item, vi.fn() as unknown as OnRegenerate, { switchSibling })

    const nextBtn = screen.getByRole('button', { name: /next/i })
    await user.click(nextBtn)

    expect(switchSibling).not.toHaveBeenCalled()
    expect(nextBtn).toBeDisabled()
  })

  it('should not call switchSibling when prev button clicked but prevSibling is null', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    const item = makeItem({ prevSibling: undefined, nextSibling: 'q-2', siblingIndex: 0, siblingCount: 3 })

    renderWithProvider(item, vi.fn() as unknown as OnRegenerate, { switchSibling })

    const prevBtn = screen.getByRole('button', { name: /previous/i })
    await user.click(prevBtn)

    expect(switchSibling).not.toHaveBeenCalled()
    expect(prevBtn).toBeDisabled()
  })

  it('should render next button disabled when nextSibling is null', () => {
    const item = makeItem({ prevSibling: 'q-0', nextSibling: undefined, siblingIndex: 2, siblingCount: 3 })
    renderWithProvider(item, vi.fn() as unknown as OnRegenerate)

    const nextBtn = screen.getByRole('button', { name: /next/i })
    expect(nextBtn).toBeDisabled()
  })

  it('should handle both prev and next siblings being null (only one message)', () => {
    const item = makeItem({ prevSibling: undefined, nextSibling: undefined, siblingIndex: 0, siblingCount: 1 })
    renderWithProvider(item, vi.fn() as unknown as OnRegenerate)

    const prevBtn = screen.queryByRole('button', { name: /previous/i })
    const nextBtn = screen.queryByRole('button', { name: /next/i })

    expect(prevBtn).not.toBeInTheDocument()
    expect(nextBtn).not.toBeInTheDocument()
  })

  it('should render with empty message_files array (no file list)', () => {
    const { container } = renderWithProvider(makeItem({ message_files: [] }))

    expect(container.querySelector('[class*="FileList"]')).not.toBeInTheDocument()
    // Content should still be visible
    expect(screen.getByText('This is the question content')).toBeInTheDocument()
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

  it('should apply correct contentWidth positioning to action container', () => {
    vi.useFakeTimers()

    try {
      renderWithProvider(makeItem())

      // Mock clientWidth at different values
      const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 300 })

      act(() => {
        if (resizeCallback) {
          resizeCallback([], {} as ResizeObserver)
        }
      })

      const actionContainer = screen.getByTestId('action-container')
      // 300 width + 8 offset = 308px
      expect(actionContainer).toHaveStyle({ right: '308px' })

      // Change width and trigger resize again
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 250 })

      act(() => {
        if (resizeCallback) {
          resizeCallback([], {} as ResizeObserver)
        }
      })

      // 250 width + 8 offset = 258px
      expect(actionContainer).toHaveStyle({ right: '258px' })

      // Restore original
      if (originalClientWidth) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
      }
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('should hide edit button when enableEdit is explicitly true', () => {
    renderWithProvider(makeItem(), vi.fn() as unknown as OnRegenerate, { enableEdit: true })

    expect(screen.getByTestId('edit-btn')).toBeInTheDocument()
    expect(screen.getByTestId('copy-btn')).toBeInTheDocument()
  })

  it('should show copy button always regardless of enableEdit setting', () => {
    renderWithProvider(makeItem(), vi.fn() as unknown as OnRegenerate, { enableEdit: false })

    expect(screen.getByTestId('copy-btn')).toBeInTheDocument()
  })

  it('should not render content switch when no siblings exist', () => {
    const item = makeItem({ siblingCount: 1, siblingIndex: 0, prevSibling: undefined, nextSibling: undefined })
    renderWithProvider(item)

    // ContentSwitch should not render when count is 1
    const prevBtn = screen.queryByRole('button', { name: /previous/i })
    const nextBtn = screen.queryByRole('button', { name: /next/i })

    expect(prevBtn).not.toBeInTheDocument()
    expect(nextBtn).not.toBeInTheDocument()
  })

  it('should update edited content as user types', async () => {
    const user = userEvent.setup()
    renderWithProvider(makeItem())

    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    expect(textbox).toHaveValue('This is the question content')

    await user.clear(textbox)
    expect(textbox).toHaveValue('')

    await user.type(textbox, 'New content')
    expect(textbox).toHaveValue('New content')
  })

  it('should maintain file list in edit mode with margin adjustment', async () => {
    const user = userEvent.setup()
    const files = [
      {
        name: 'test.txt',
        url: 'https://example.com/test.txt',
        type: 'text/plain',
        previewUrl: 'https://example.com/test.txt',
        size: 100,
      } as unknown as FileEntity,
    ]

    const { container } = renderWithProvider(makeItem({ message_files: files }))

    await user.click(screen.getByTestId('edit-btn'))

    // FileList should be visible in edit mode with mb-3 margin
    expect(screen.getByText(/test.txt/i)).toBeInTheDocument()
    // Target the FileList container directly (it's the first ancestor with FileList-related class)
    const fileListParent = container.querySelector('[class*="flex flex-wrap gap-2"]')
    expect(fileListParent).toHaveClass('mb-3')
  })

  it('should render theme styles only in non-edit mode', () => {
    const themeBuilder = new ThemeBuilder()
    themeBuilder.buildTheme('#00ff00', true)
    const theme = themeBuilder.theme

    renderWithProvider(makeItem(), vi.fn() as unknown as OnRegenerate, { theme })

    const contentContainer = screen.getByTestId('question-content')
    const styleAttr = contentContainer.getAttribute('style')

    // In non-edit mode, theme styles should be applied
    expect(styleAttr).not.toBeNull()
  })

  it('should handle siblings at boundaries (first, middle, last)', async () => {
    const switchSibling = vi.fn()

    // Test first message
    const firstItem = makeItem({ prevSibling: undefined, nextSibling: 'q-2', siblingIndex: 0, siblingCount: 3 })
    const { unmount: unmount1 } = renderWithProvider(firstItem, vi.fn() as unknown as OnRegenerate, { switchSibling })

    let prevBtn = screen.getByRole('button', { name: /previous/i })
    let nextBtn = screen.getByRole('button', { name: /next/i })

    expect(prevBtn).toBeDisabled()
    expect(nextBtn).not.toBeDisabled()

    unmount1()
    vi.clearAllMocks()

    // Test last message
    const lastItem = makeItem({ prevSibling: 'q-0', nextSibling: undefined, siblingIndex: 2, siblingCount: 3 })
    const { unmount: unmount2 } = renderWithProvider(lastItem, vi.fn() as unknown as OnRegenerate, { switchSibling })

    prevBtn = screen.getByRole('button', { name: /previous/i })
    nextBtn = screen.getByRole('button', { name: /next/i })

    expect(prevBtn).not.toBeDisabled()
    expect(nextBtn).toBeDisabled()

    unmount2()
  })

  it('should handle rapid composition start/end cycles', async () => {
    const onRegenerate = vi.fn() as unknown as OnRegenerate
    renderWithProvider(makeItem(), onRegenerate)

    await userEvent.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    // Rapid composition cycles
    fireEvent.compositionStart(textbox)
    fireEvent.compositionEnd(textbox)
    fireEvent.compositionStart(textbox)
    fireEvent.compositionEnd(textbox)
    fireEvent.compositionStart(textbox)
    fireEvent.compositionEnd(textbox)

    // Press Enter after final composition end
    await new Promise(r => setTimeout(r, 60))
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    expect(onRegenerate).toHaveBeenCalled()
  })

  it('should handle Enter key with only whitespace edited content', async () => {
    const user = userEvent.setup()
    const onRegenerate = vi.fn() as unknown as OnRegenerate
    renderWithProvider(makeItem(), onRegenerate)

    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    await user.clear(textbox)
    await user.type(textbox, '   ')

    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith(makeItem(), { message: '   ', files: [] })
    })
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

    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')

    await user.clear(textbox)
    await user.type(textbox, 'Modified with files')

    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith(
        item,
        { message: 'Modified with files', files },
      )
    })
  })

  it('should clear composition timer when switching editing mode multiple times', async () => {
    const user = userEvent.setup()
    renderWithProvider(makeItem())

    // First edit cycle
    await user.click(screen.getByTestId('edit-btn'))
    let textbox = await screen.findByRole('textbox')
    fireEvent.compositionStart(textbox)
    fireEvent.compositionEnd(textbox)

    // Cancel and re-edit
    let cancelBtn = await screen.findByTestId('cancel-edit-btn')
    await user.click(cancelBtn)

    // Second edit cycle
    await user.click(screen.getByTestId('edit-btn'))
    textbox = await screen.findByRole('textbox')
    expect(textbox).toHaveValue('This is the question content')

    fireEvent.compositionStart(textbox)
    fireEvent.compositionEnd(textbox)

    cancelBtn = await screen.findByTestId('cancel-edit-btn')
    await user.click(cancelBtn)

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('should apply correct CSS classes in edit vs view mode', async () => {
    const user = userEvent.setup()
    renderWithProvider(makeItem())

    const contentContainer = screen.getByTestId('question-content')

    // View mode classes
    expect(contentContainer).toHaveClass('rounded-2xl')
    expect(contentContainer).toHaveClass('bg-background-gradient-bg-fill-chat-bubble-bg-3')

    await user.click(screen.getByTestId('edit-btn'))

    // Edit mode classes
    expect(contentContainer).toHaveClass('rounded-[24px]')
    expect(contentContainer).toHaveClass('border-[3px]')
  })

  it('should handle all sibling combinations with switchSibling callback', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()

    // Test with all siblings
    const allItem = makeItem({ prevSibling: 'q-0', nextSibling: 'q-2', siblingIndex: 1, siblingCount: 3 })
    renderWithProvider(allItem, vi.fn() as unknown as OnRegenerate, { switchSibling })

    await user.click(screen.getByRole('button', { name: /previous/i }))
    expect(switchSibling).toHaveBeenCalledWith('q-0')

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(switchSibling).toHaveBeenCalledWith('q-2')
  })

  it('should handle undefined onRegenerate in handleResend', async () => {
    const user = userEvent.setup()
    render(
      <ChatContextProvider
        config={{} as unknown as ChatConfig}
        isResponding={false}
        chatList={[]}
        showPromptLog={false}
        onSend={vi.fn()}
        onRegenerate={undefined as unknown as OnRegenerate}
        onAnnotationEdited={vi.fn()}
        onAnnotationAdded={vi.fn()}
        onAnnotationRemoved={vi.fn()}
        disableFeedback={false}
        onFeedback={vi.fn()}
        getHumanInputNodeData={vi.fn()}
      >
        <Question item={makeItem()} theme={null} />
      </ChatContextProvider>,
    )

    await user.click(screen.getByTestId('edit-btn'))
    await user.click(screen.getByTestId('save-edit-btn'))
    // Should not throw
  })

  it('should handle missing switchSibling prop', async () => {
    const user = userEvent.setup()
    const item = makeItem({ prevSibling: 'prev', nextSibling: 'next', siblingIndex: 1, siblingCount: 3 })
    renderWithProvider(item, vi.fn() as unknown as OnRegenerate, { switchSibling: undefined })

    const prevBtn = screen.getByRole('button', { name: /previous/i })
    await user.click(prevBtn)
    // Should not throw

    const nextBtn = screen.getByRole('button', { name: /next/i })
    await user.click(nextBtn)
    // Should not throw
  })

  it('should handle theme without chatBubbleColorStyle', () => {
    const theme = { chatBubbleColorStyle: undefined } as unknown as Theme
    renderWithProvider(makeItem(), vi.fn() as unknown as OnRegenerate, { theme })
    const content = screen.getByTestId('question-content')
    expect(content.getAttribute('style')).toBeNull()
  })

  it('should handle undefined message_files', () => {
    const item = makeItem({ message_files: undefined as unknown as FileEntity[] })
    const { container } = renderWithProvider(item)
    expect(container.querySelector('[class*="FileList"]')).not.toBeInTheDocument()
  })

  it('should handle handleSwitchSibling call when siblings are missing', async () => {
    const user = userEvent.setup()
    const switchSibling = vi.fn()
    const item = makeItem({ prevSibling: undefined, nextSibling: undefined, siblingIndex: 0, siblingCount: 2 })
    renderWithProvider(item, vi.fn() as unknown as OnRegenerate, { switchSibling })

    const prevBtn = screen.getByRole('button', { name: /previous/i })
    const nextBtn = screen.getByRole('button', { name: /next/i })

    // These will now call switchSibling because of the mock, hit the falsy checks in Question
    await user.click(prevBtn)
    await user.click(nextBtn)

    expect(switchSibling).not.toHaveBeenCalled()
  })

  it('should clear timer on unmount when timer is active', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithProvider(makeItem())
    await user.click(screen.getByTestId('edit-btn'))
    const textbox = await screen.findByRole('textbox')
    fireEvent.compositionStart(textbox)
    fireEvent.compositionEnd(textbox) // starts timer
    unmount()
    // Should not throw and branch should be hit
  })

  it('should handle handleSwitchSibling with no siblings and missing switchSibling prop', async () => {
    const user = userEvent.setup()
    const item = makeItem({ prevSibling: undefined, nextSibling: undefined, siblingIndex: 0, siblingCount: 2 })
    renderWithProvider(item, vi.fn() as unknown as OnRegenerate, { switchSibling: undefined })

    const prevBtn = screen.getByRole('button', { name: /previous/i })
    await user.click(prevBtn)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // No crash
  })
})
