import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context-provider'
import ThinkBlock from '../think-block'

// Helper to wrap component with ChatContextProvider
const renderWithContext = (children: React.ReactNode, isResponding: boolean = true) => {
  return render(
    <ChatContextProvider
      config={undefined}
      isResponding={isResponding}
      chatList={[]}
      questionIcon={undefined}
      answerIcon={undefined}
      onSend={undefined}
      onRegenerate={undefined}
      onAnnotationEdited={undefined}
      onAnnotationAdded={undefined}
      onAnnotationRemoved={undefined}
      onFeedback={undefined}
    >
      {children}
    </ChatContextProvider>,
  )
}

describe('ThinkBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render regular details element when data-think is false', () => {
      render(
        <ThinkBlock data-think={false}>
          <p>Regular content</p>
        </ThinkBlock>,
      )

      expect(screen.getByText('Regular content')).toBeInTheDocument()
    })
  })

  describe('Timer behavior', () => {
    it('should update elapsed time while thinking', () => {
      renderWithContext(
        <ThinkBlock data-think={true}>
          <p>Thinking...</p>
        </ThinkBlock>,
        true,
      )

      // Initial state should show 0.0s
      expect(screen.getByText(/\(0\.0s\)/)).toBeInTheDocument()

      // Advance timer by 500ms and run pending timers
      act(() => {
        vi.advanceTimersByTime(500)
      })

      // Should show approximately 0.5s
      expect(screen.getByText(/\(0\.5s\)/)).toBeInTheDocument()
    })

    it('should stop timer when isResponding becomes false', () => {
      const { rerender } = render(
        <ChatContextProvider
          config={undefined}
          isResponding={true}
          chatList={[]}
          questionIcon={undefined}
          answerIcon={undefined}
          onSend={undefined}
          onRegenerate={undefined}
          onAnnotationEdited={undefined}
          onAnnotationAdded={undefined}
          onAnnotationRemoved={undefined}
          onFeedback={undefined}
        >
          <ThinkBlock data-think={true}>
            <p>Thinking content</p>
          </ThinkBlock>
        </ChatContextProvider>,
      )

      // Verify initial thinking state
      expect(screen.getByText(/chat\.thinking/)).toBeInTheDocument()

      // Advance timer
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Simulate user clicking stop (isResponding becomes false)
      rerender(
        <ChatContextProvider
          config={undefined}
          isResponding={false}
          chatList={[]}
          questionIcon={undefined}
          answerIcon={undefined}
          onSend={undefined}
          onRegenerate={undefined}
          onAnnotationEdited={undefined}
          onAnnotationAdded={undefined}
          onAnnotationRemoved={undefined}
          onFeedback={undefined}
        >
          <ThinkBlock data-think={true}>
            <p>Thinking content</p>
          </ThinkBlock>
        </ChatContextProvider>,
      )

      // Should now show "Thought" instead of "Thinking..."
      expect(screen.getByText(/chat\.thought/)).toBeInTheDocument()
      const stoppedTime = screen.getByText(/\(1\.0s\)/).textContent
      act(() => vi.advanceTimersByTime(2000))
      expect(screen.getByText(/\(1\.0s\)/)).toHaveTextContent(stoppedTime!)
    })

    it('should stop timer when isResponding is undefined (historical conversation outside active response)', () => {
      // Render without ChatContextProvider — simulates historical conversation
      render(
        <ThinkBlock data-think={true}>
          <p>Content without ENDTHINKFLAG</p>
        </ThinkBlock>,
      )

      // Timer should be stopped immediately — isResponding undefined means not in active response
      expect(screen.getByText(/chat\.thought/)).toBeInTheDocument()
      expect(screen.queryByText(/\(0\.0s\)/)).not.toBeInTheDocument()
    })
  })

  describe('ENDTHINKFLAG handling', () => {
    it('should remove ENDTHINKFLAG from displayed content', () => {
      renderWithContext(
        <ThinkBlock data-think={true}>
          <p>Content[ENDTHINKFLAG]</p>
        </ThinkBlock>,
        true,
      )

      expect(screen.getByText('Content')).toBeInTheDocument()
      expect(screen.getByText(/chat\.thought/)).toBeInTheDocument()
      expect(screen.queryByText('[ENDTHINKFLAG]')).not.toBeInTheDocument()
    })

    it('should detect ENDTHINKFLAG in nested children', () => {
      renderWithContext(
        <ThinkBlock data-think={true}>
          <div>
            <span>Nested content[ENDTHINKFLAG]</span>
          </div>
        </ThinkBlock>,
        true,
      )

      // Should show "Thought" since ENDTHINKFLAG is present
      expect(screen.getByText(/chat\.thought/)).toBeInTheDocument()
    })

    it('should detect ENDTHINKFLAG in array children', () => {
      renderWithContext(
        <ThinkBlock data-think={true}>{['Part 1', 'Part 2[ENDTHINKFLAG]']}</ThinkBlock>,
        true,
      )

      expect(screen.getByText(/chat\.thought/)).toBeInTheDocument()
    })
  })
})
