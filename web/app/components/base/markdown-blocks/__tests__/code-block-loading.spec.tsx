import { act, render, screen, waitFor } from '@testing-library/react'
import { Theme } from '@/types/app'
import { CodeBlock } from '../code-block'

const runtime = vi.hoisted(() => {
  let resolve = () => undefined as void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return {
    chartLoaded: false,
    musicLoaded: false,
    renderMusic: vi.fn(() => [{}]),
    loadControls: vi.fn(),
    setTune: vi.fn(),
    musicReady: { promise, resolve },
  }
})

vi.mock('@/hooks/use-theme', () => ({ default: () => ({ theme: Theme.light }) }))
vi.mock('../shiki-highlight', () => ({
  highlightCode: async ({ code }: { code: string }) => <pre>{code}</pre>,
}))
vi.mock('echarts-for-react', () => {
  runtime.chartLoaded = true
  return {
    default: ({ option }: { option: unknown }) => (
      <div data-testid="chart">{JSON.stringify(option)}</div>
    ),
  }
})
vi.mock('abcjs', async () => {
  runtime.musicLoaded = true
  await runtime.musicReady.promise
  return {
    default: {
      renderAbc: runtime.renderMusic,
      synth: {
        SynthController: class {
          load = runtime.loadControls
          setTune = runtime.setTune
        },
        CreateSynth: class {
          init = () => Promise.resolve()
        },
      },
    },
  }
})

it('loads chart and music runtimes only when their code-block language is rendered', async () => {
  const { rerender } = render(
    <CodeBlock className="language-typescript">const answer = 42</CodeBlock>,
  )
  await waitFor(() => expect(screen.getByText('const answer = 42')).toBeInTheDocument())
  expect(runtime.chartLoaded).toBe(false)
  expect(runtime.musicLoaded).toBe(false)

  rerender(<CodeBlock className="language-echarts">{'{"series":[]}'}</CodeBlock>)
  expect(await screen.findByTestId('chart')).toHaveTextContent('{"series":[]}')
  expect(runtime.chartLoaded).toBe(true)
  expect(runtime.musicLoaded).toBe(false)

  const score = 'X:1\nK:C\nC D E F|'
  rerender(<CodeBlock className="language-abc">{score}</CodeBlock>)
  await waitFor(() => expect(runtime.musicLoaded).toBe(true))
  expect(runtime.renderMusic).not.toHaveBeenCalled()
  // Streaming can continue while the renderer chunk is still loading.
  const completeScore = `${score}\nG A B c|`
  rerender(<CodeBlock className="language-abc">{completeScore}</CodeBlock>)
  await act(async () => runtime.musicReady.resolve())
  await waitFor(() =>
    expect(runtime.renderMusic).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      completeScore,
      expect.objectContaining({ responsive: 'resize' }),
    ),
  )
  expect(runtime.musicLoaded).toBe(true)
  expect(runtime.loadControls).toHaveBeenCalledWith(
    expect.any(HTMLDivElement),
    {},
    { displayPlay: true },
  )
  await waitFor(() => expect(runtime.setTune).toHaveBeenCalled())
})
