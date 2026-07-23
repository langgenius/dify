import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReasoningPanel from '../reasoning-panel'

// Mock react-i18next so the reused chat.thinking/chat.thought labels resolve.

// Mock the heavy Markdown renderer to a simple passthrough.
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => (
    <div data-testid="reasoning-markdown">{content}</div>
  ),
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
    const { container } = render(<ReasoningPanel content={{}} done={false} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the thinking state while not done', () => {
    render(<ReasoningPanel content={{ llm: 'let me think' }} done={false} />)
    expect(screen.getByText(/chat\.thinking/)).toBeInTheDocument()
    expect(screen.getByText('let me think')).toBeInTheDocument()
  })

  it('shows the thought state once done (answer started / terminal / history)', () => {
    render(<ReasoningPanel content={{ llm: 'done thinking' }} done />)
    expect(screen.getByText(/chat\.thought/)).toBeInTheDocument()
  })

  it('counts elapsed time up while thinking', () => {
    render(<ReasoningPanel content={{ llm: 'thinking' }} done={false} />)
    expect(screen.getByText(/\(0\.0s\)/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(screen.getByText(/\(0\.5s\)/)).toBeInTheDocument()
  })

  it('freezes the timer once done (latched), even if it flips back', () => {
    const { rerender } = render(<ReasoningPanel content={{ llm: 'thinking' }} done={false} />)
    act(() => {
      vi.advanceTimersByTime(700)
    })
    // Answer starts → done latches; timer must stop at 0.7s.
    rerender(<ReasoningPanel content={{ llm: 'thinking' }} done />)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText(/chat\.thought\(0\.7s\)/)).toBeInTheDocument()
  })

  it('concatenates reasoning from multiple LLM nodes', () => {
    render(<ReasoningPanel content={{ llm1: 'first', llm2: 'second' }} done={false} />)
    expect(screen.getByTestId('reasoning-markdown')).toHaveTextContent('first second')
  })

  it('reflects in-place mutation of the same content object (streaming)', () => {
    // The live stream mutates the same reasoningContent object under a stable reference,
    // then re-renders. The panel must reflect the appended delta, not a stale snapshot.
    const content: Record<string, string> = { llm: 'first' }
    const { rerender } = render(<ReasoningPanel content={content} done={false} />)
    expect(screen.getByTestId('reasoning-markdown')).toHaveTextContent('first')

    content.llm = 'first second'
    rerender(<ReasoningPanel content={content} done={false} />)
    expect(screen.getByTestId('reasoning-markdown')).toHaveTextContent('first second')
  })
})
