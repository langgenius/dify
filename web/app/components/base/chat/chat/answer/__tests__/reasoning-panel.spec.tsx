import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReasoningPanel from '../reasoning-panel'

// Mock react-i18next so the reused chat.thinking/chat.thought labels resolve.
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

// Mock the heavy Markdown renderer to a simple passthrough.
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div data-testid="reasoning-markdown">{content}</div>,
}))

describe('ReasoningPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when there is no reasoning text', () => {
    const { container } = render(<ReasoningPanel content={{}} responding />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the thinking state while responding and not finished', () => {
    render(<ReasoningPanel content={{ llm: 'let me think' }} responding />)
    expect(screen.getByText(/Thinking\.\.\./)).toBeInTheDocument()
    expect(screen.getByText('let me think')).toBeInTheDocument()
  })

  it('shows the thought state once finished', () => {
    render(<ReasoningPanel content={{ llm: 'done thinking' }} isFinished responding />)
    expect(screen.getByText(/Thought/)).toBeInTheDocument()
  })

  it('shows the thought state when the response is no longer active (history)', () => {
    render(<ReasoningPanel content={{ llm: 'recalled reasoning' }} responding={false} />)
    expect(screen.getByText(/Thought/)).toBeInTheDocument()
  })

  it('counts elapsed time up while thinking', () => {
    render(<ReasoningPanel content={{ llm: 'thinking' }} responding />)
    expect(screen.getByText(/\(0\.0s\)/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByText(/\(0\.5s\)/)).toBeInTheDocument()
  })

  it('concatenates reasoning from multiple LLM nodes', () => {
    render(<ReasoningPanel content={{ llm1: 'first', llm2: 'second' }} responding />)
    expect(screen.getByTestId('reasoning-markdown')).toHaveTextContent('first second')
  })
})
