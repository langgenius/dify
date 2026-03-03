import type { Theme } from '../../embedded-chatbot/theme/theme-context'
import type { ChatConfig, ChatItem, OnRegenerate } from '../../types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import * as React from 'react'

import Toast from '../../../toast'
import { ThemeBuilder } from '../../embedded-chatbot/theme/theme-context'
import { ChatContextProvider } from '../context'
import Question from '../question'

// Global Mocks
vi.mock('@react-aria/interactions', () => ({
  useFocusVisible: () => ({ isFocusVisible: false }),
}))
vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }))

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

    // Get all buttons and find the save button (it's typically the last button in the edit mode)
    const buttons = screen.getAllByRole('button')
    const saveBtn = buttons[buttons.length - 1] // The save button is usually the last one
    await user.click(saveBtn)

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

    // Get all buttons and find the cancel button (it appears before the save button in edit mode)
    const buttons = screen.getAllByRole('button')
    // The cancel button is the second-to-last button in the edit mode action bar
    const cancelBtn = buttons[buttons.length - 2]
    await user.click(cancelBtn)

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      const md = container.querySelector('.markdown-body')
      expect(md).toBeInTheDocument()
    })
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
    const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter' })
    Object.defineProperty(event, 'isComposing', { value: true })

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

    // Timer is running again, let's click cancel to hit lines 79-80
    const buttons = screen.getAllByRole('button')
    const cancelBtn = buttons[buttons.length - 2]
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

    const buttons = screen.getAllByRole('button')
    const saveBtn = buttons[buttons.length - 1]
    await user.click(saveBtn) // handleResend clears timer

    expect(onRegenerate).toHaveBeenCalled()
  })
})
