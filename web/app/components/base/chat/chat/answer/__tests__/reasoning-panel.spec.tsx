import { act, screen } from '@testing-library/react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ReasoningPanel from '../reasoning-panel'

afterEach(() => vi.useRealTimers())

it('freezes elapsed thinking time after completion even if done flips back', () => {
  vi.useFakeTimers()
  const { rerender } = render(<ReasoningPanel content={{ llm: 'thinking' }} done={false} />)
  act(() => vi.advanceTimersByTime(700))
  expect(screen.getByText(/chat\.thinking\(0\.7s\)/)).toBeInTheDocument()

  rerender(<ReasoningPanel content={{ llm: 'thinking' }} done />)
  rerender(<ReasoningPanel content={{ llm: 'thinking' }} done={false} />)
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByText(/chat\.thought\(0\.7s\)/)).toBeInTheDocument()
})

it('does not start an elapsed timer for historical reasoning', () => {
  vi.useFakeTimers()
  render(<ReasoningPanel content={{ llm: 'done thinking' }} done />)
  act(() => vi.advanceTimersByTime(1000))
  expect(screen.getByText(/chat\.thought\(0\.0s\)/)).toBeInTheDocument()
})

it('updates streaming content in place and keeps different nodes in separate paragraphs', async () => {
  const content: Record<string, string> = {}
  const { rerender } = render(<ReasoningPanel content={content} done={false} />)
  expect(screen.queryByText(/chat\.thinking/)).not.toBeInTheDocument()

  content.llm = 'first'
  rerender(<ReasoningPanel content={content} done={false} />)
  expect(await screen.findByText('first')).toBeInTheDocument()

  content.llm = 'first delta'
  content.second = 'another node'
  rerender(<ReasoningPanel content={content} done={false} />)
  expect(await screen.findByText('first delta')).toBeInTheDocument()
  expect(screen.getByText('another node')).toBeInTheDocument()
  expect(screen.queryByText('first')).not.toBeInTheDocument()
})
