import { act, render, screen } from '@testing-library/react'
import ReasoningPanel from '../reasoning-panel'

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

describe('ReasoningPanel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('freezes elapsed thinking time after completion even if done flips back', () => {
    const { rerender } = render(<ReasoningPanel content={{ llm: 'thinking' }} done={false} />)
    act(() => vi.advanceTimersByTime(700))
    expect(screen.getByText(/chat\.thinking\(0\.7s\)/)).toBeInTheDocument()

    rerender(<ReasoningPanel content={{ llm: 'thinking' }} done />)
    rerender(<ReasoningPanel content={{ llm: 'thinking' }} done={false} />)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText(/chat\.thought\(0\.7s\)/)).toBeInTheDocument()
  })

  it('does not start an elapsed timer for historical reasoning', () => {
    render(<ReasoningPanel content={{ llm: 'done thinking' }} done />)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText(/chat\.thought\(0\.0s\)/)).toBeInTheDocument()
  })

  it('updates streaming content in place and separates reasoning from different nodes', () => {
    const content: Record<string, string> = {}
    const { container, rerender } = render(<ReasoningPanel content={content} done={false} />)
    expect(container).toBeEmptyDOMElement()

    content.llm = 'first'
    rerender(<ReasoningPanel content={content} done={false} />)
    expect(screen.getByText('first')).toBeInTheDocument()

    content.llm = 'first delta'
    content.second = 'another node'
    rerender(<ReasoningPanel content={content} done={false} />)
    expect(screen.getByText('first delta another node').textContent).toBe(
      'first delta\n\nanother node',
    )
  })
})
