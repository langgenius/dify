import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatContextProvider } from '@/app/components/base/chat/chat/context'
import ThinkBlock from './think-block'

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'chat.thinking': 'Thinking...',
        'chat.thought': 'Thought',
      }
      return translations[key] || key
    },
  }),
}))

// Helper to wrap component with ChatContextProvider
const renderWithContext = (
  children: React.ReactNode,
  isResponding: boolean = true,
) => {
  return render(
    <ChatContextProvider
      config={undefined}
      isResponding={isResponding}
      chatList={[]}
      showPromptLog={false}
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

    it('should render think block with thinking state when data-think is true', () => {
      renderWithContext(
        <ThinkBlock data-think={true}>
          <p>Thinking content</p>
        </ThinkBlock>,
        true,
      )

      expect(screen.getByText(/Thinking\.\.\./)).toBeInTheDocument()
      expect(screen.getByText('Thinking content')).toBeInTheDocument()
    })

    it('should render thought state when content has ENDTHINKFLAG', () => {
      renderWithContext(
        <ThinkBlock data-think={true}>
          <p>Completed thinking[ENDTHINKFLAG]</p>
        </ThinkBlock>,
        true,
      )

      expect(screen.getByText(/Thought/)).toBeInTheDocument()
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
          showPromptLog={false}
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
      expect(screen.getByText(/Thinking\.\.\./)).toBeInTheDocument()

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
          showPromptLog={false}
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
      expect(screen.getByText(/Thought/)).toBeInTheDocument()
    })

    it('should NOT stop timer when isResponding is undefined (outside ChatContextProvider)', () => {
      // Render without ChatContextProvider
      render(
        <ThinkBlock data-think={true}>
          <p>Content without ENDTHINKFLAG</p>
        </ThinkBlock>,
      )

      // Initial state should show "Thinking..."
      expect(screen.getByText(/Thinking\.\.\./)).toBeInTheDocument()

      // Advance timer
      act(() => {
        vi.advanceTimersByTime(2000)
      })

      // Timer should still be running (showing "Thinking..." not "Thought")
      expect(screen.getByText(/Thinking\.\.\./)).toBeInTheDocument()
      expect(screen.getByText(/\(2\.0s\)/)).toBeInTheDocument()
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
      expect(screen.getByText(/Thought/)).toBeInTheDocument()
    })

    it('should detect ENDTHINKFLAG in array children', () => {
      renderWithContext(
        <ThinkBlock data-think={true}>
          {['Part 1', 'Part 2[ENDTHINKFLAG]']}
        </ThinkBlock>,
        true,
      )

      expect(screen.getByText(/Thought/)).toBeInTheDocument()
    })
  })

  describe('Edge cases', () => {
    it('should handle empty children', () => {
      renderWithContext(
        <ThinkBlock data-think={true}></ThinkBlock>,
        true,
      )

      expect(screen.getByText(/Thinking\.\.\./)).toBeInTheDocument()
    })

    it('should handle null children gracefully', () => {
      renderWithContext(
        <ThinkBlock data-think={true}>
          {null}
        </ThinkBlock>,
        true,
      )

      expect(screen.getByText(/Thinking\.\.\./)).toBeInTheDocument()
    })
  })
})
