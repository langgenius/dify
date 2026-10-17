import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import mermaid from 'mermaid'
import Flowchart from '../index'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(),
    mermaidAPI: { render: vi.fn() },
  },
}))

const svg = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg"><text>${label}</text></svg>`
const flushRender = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(700)
  })
let sequence = 0
let code: string

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  code = `graph TD\n  A${++sequence}-->B`
  vi.mocked(mermaid.initialize).mockImplementation(() => {})
  vi.mocked(mermaid.render).mockResolvedValue({
    svg: svg('Classic diagram'),
    diagramType: 'flowchart',
  })
  vi.mocked(mermaid.mermaidAPI.render).mockResolvedValue({
    svg: svg('Hand drawn diagram'),
    diagramType: 'flowchart',
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it('debounces streamed code and renders only the latest complete diagram', async () => {
  const { rerender } = render(<Flowchart PrimitiveCode="graph" />)
  await flushRender()
  expect(mermaid.render).not.toHaveBeenCalled()
  rerender(<Flowchart PrimitiveCode={code} />)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  const finalCode = `${code}\n B-->C`
  rerender(<Flowchart PrimitiveCode={finalCode} />)
  expect(mermaid.render).not.toHaveBeenCalled()
  await flushRender()
  expect(mermaid.render).toHaveBeenCalledTimes(1)
  expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('B-->C'))
  expect(screen.getByText('Classic diagram')).toBeInTheDocument()
})

it.each([
  ['gantt\ntitle T\nTask :after task1, after task2', 'Task :after task1 task2'],
  ['gantt\ntitle T\nTask :after task1, 2024-01-01, 1d', 'Task :after task1, 2024-01-01, 1d'],
  ['mindmap\n  root\n    topic1', 'mindmap\n  root\n    topic1'],
  ['sequenceDiagram\n  A->>B: Hi', 'sequenceDiagram\n  A->>B: Hi'],
])('passes the expected syntax to Mermaid for %s', async (input, expected) => {
  render(<Flowchart PrimitiveCode={input} theme="light" />)
  await flushRender()
  expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), expect.stringContaining(expected))
  expect(screen.getByText('Classic diagram')).toBeInTheDocument()
})

it('switches look and theme through the displayed controls', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<Flowchart PrimitiveCode={code} theme="light" />)
  await flushRender()
  await user.click(screen.getByRole('button', { name: 'app.mermaid.handDrawn' }))
  await flushRender()
  expect(screen.getByText('Hand drawn diagram')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'app.mermaid.handDrawn' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await user.click(screen.getByRole('button', { name: 'app.theme.switchDark' }))
  await flushRender()
  expect(mermaid.initialize).toHaveBeenLastCalledWith(
    expect.objectContaining({
      theme: 'default',
      themeVariables: expect.objectContaining({ primaryBorderColor: '#60a5fa' }),
    }),
  )
  await user.click(screen.getByRole('button', { name: 'app.mermaid.classic' }))
  await flushRender()
  expect(screen.getByText('Classic diagram')).toBeInTheDocument()
  expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }))
})

it('shows invalid code feedback without sending incomplete syntax to Mermaid', async () => {
  render(<Flowchart PrimitiveCode="graph TD\nA -->" />)
  await flushRender()
  expect(screen.getByText('Diagram code is not complete or invalid.')).toBeInTheDocument()
  expect(mermaid.render).not.toHaveBeenCalled()
})

it('shows a rendering failure and recovers when valid code arrives', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(mermaid.render).mockRejectedValue(new Error('Syntax error'))
  const { rerender } = render(<Flowchart PrimitiveCode={code} />)
  await flushRender()
  expect(screen.getByText('Rendering failed: Syntax error')).toBeInTheDocument()
  vi.mocked(mermaid.render).mockResolvedValue({
    svg: svg('Recovered diagram'),
    diagramType: 'flowchart',
  })
  rerender(<Flowchart PrimitiveCode={`${code}\nB-->C`} />)
  await flushRender()
  expect(screen.getByText('Recovered diagram')).toBeInTheDocument()
  expect(screen.queryByText(/Rendering failed/)).not.toBeInTheDocument()
})

it('shows a configuration failure instead of waiting indefinitely', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const { rerender } = render(<Flowchart PrimitiveCode={code} />)
  await flushRender()
  vi.mocked(mermaid.initialize).mockImplementation(() => {
    throw new Error('Config failed')
  })
  rerender(<Flowchart PrimitiveCode={`${code}\nB-->C`} />)
  await flushRender()
  expect(screen.getByText('common.api.actionFailed')).toBeInTheDocument()
  expect(screen.queryByText('app.mermaid.waitForCompletion')).not.toBeInTheDocument()
})

it('restores the cached SVG when returning to a previously rendered diagram', async () => {
  vi.mocked(mermaid.render)
    .mockResolvedValueOnce({ svg: svg('First diagram'), diagramType: 'flowchart' })
    .mockResolvedValueOnce({ svg: svg('Second diagram'), diagramType: 'flowchart' })
  const { rerender } = render(<Flowchart PrimitiveCode={code} />)
  await flushRender()
  expect(screen.getByText('First diagram')).toBeInTheDocument()
  rerender(<Flowchart PrimitiveCode={`${code}\nB-->C`} />)
  await flushRender()
  expect(screen.getByText('Second diagram')).toBeInTheDocument()
  rerender(<Flowchart PrimitiveCode={code} />)
  await flushRender()
  expect(screen.getByText('First diagram')).toBeInTheDocument()
  expect(screen.queryByText('Second diagram')).not.toBeInTheDocument()
  expect(mermaid.render).toHaveBeenCalledTimes(2)
})

it('keeps the current SVG visible while loading and ignores an older render that finishes last', async () => {
  let resolveOld!: (value: { svg: string; diagramType: string }) => void
  const { rerender } = render(<Flowchart PrimitiveCode={code} />)
  await flushRender()
  vi.mocked(mermaid.render).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveOld = resolve
    }),
  )
  rerender(<Flowchart PrimitiveCode={`${code}\nB-->Old`} />)
  await flushRender()
  expect(screen.getByText('Classic diagram')).toBeInTheDocument()
  vi.mocked(mermaid.render).mockResolvedValue({
    svg: svg('Latest diagram'),
    diagramType: 'flowchart',
  })
  rerender(<Flowchart PrimitiveCode={`${code}\nB-->Latest`} />)
  await flushRender()
  expect(screen.getByText('Latest diagram')).toBeInTheDocument()
  await act(async () => {
    resolveOld({ svg: svg('Obsolete diagram'), diagramType: 'flowchart' })
  })
  expect(screen.getByText('Latest diagram')).toBeInTheDocument()
  expect(screen.queryByText('Obsolete diagram')).not.toBeInTheDocument()
})

it('opens a preview of the rendered SVG and closes it through the preview action', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<Flowchart PrimitiveCode={code} />)
  await flushRender()
  await user.click(screen.getByText('Classic diagram'))
  await flushRender()
  expect(screen.getByTestId('image-preview-container')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
  expect(screen.queryByTestId('image-preview-container')).not.toBeInTheDocument()
})

it('cancels a scheduled render when unmounted', async () => {
  const { unmount } = render(<Flowchart PrimitiveCode={code} />)
  unmount()
  await flushRender()
  expect(mermaid.render).not.toHaveBeenCalled()
})
