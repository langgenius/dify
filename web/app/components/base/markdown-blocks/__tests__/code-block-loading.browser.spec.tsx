import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { CodeBlock } from '../code-block'

const runtime = vi.hoisted(() => {
  const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }
  return {
    chart: { started: false, ready: deferred() },
    music: { started: false, ready: deferred() },
    svg: { started: false, ready: deferred() },
  }
})

// boundary: delay the external chart chunk, then load its real implementation.
vi.mock('echarts-for-react', async (importOriginal) => {
  runtime.chart.started = true
  await runtime.chart.ready.promise
  return importOriginal<typeof import('echarts-for-react')>()
})
// boundary: defer the notation SDK chunk while the message continues streaming.
vi.mock('abcjs', async (importOriginal) => {
  runtime.music.started = true
  await runtime.music.ready.promise
  return importOriginal<typeof import('abcjs')>()
})
// boundary: defer the SVG SDK chunk; keep Dify's gallery and sanitizer real.
vi.mock('@svgdotjs/svg.js', async (importOriginal) => {
  runtime.svg.started = true
  await runtime.svg.ready.promise
  return importOriginal<typeof import('@svgdotjs/svg.js')>()
})

it('loads rich runtimes on demand and renders the latest message received while each chunk was pending', async () => {
  onTestFinished(guardUnexpectedFetch())
  const screen = await render(<CodeBlock className="language-text">plain message</CodeBlock>)
  await expect.element(screen.getByRole('code')).toHaveTextContent('plain message')
  expect([runtime.chart.started, runtime.music.started, runtime.svg.started]).toEqual([
    false,
    false,
    false,
  ])

  await screen.rerender(
    <CodeBlock className="language-echarts">
      {
        '{"title":{"text":"Chart ready"},"aria":{"enabled":true,"label":{"description":"Loaded chart"}}}'
      }
    </CodeBlock>,
  )
  await expect.poll(() => runtime.chart.started).toBe(true)
  expect([runtime.music.started, runtime.svg.started]).toEqual([false, false])
  runtime.chart.ready.resolve()
  // Canvas is the external SDK's rendered output, rather than an option-echoing double.
  await expect.element(screen.getByRole('img', { name: 'Loaded chart' })).toBeVisible()

  const score = 'X:1\nT:First tune\nK:C\nC D E F|'
  await screen.rerender(<CodeBlock className="language-abc">{score}</CodeBlock>)
  await expect.poll(() => runtime.music.started).toBe(true)
  await expect.element(screen.getByRole('img')).not.toBeInTheDocument()
  await screen.rerender(
    <CodeBlock className="language-abc">{score.replace('First tune', 'Latest tune')}</CodeBlock>,
  )
  runtime.music.ready.resolve()
  await expect
    .element(screen.getByRole('img', { name: 'Sheet Music for "Latest tune"' }))
    .toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Click to play/pause.' })).toBeVisible()
  expect(runtime.svg.started).toBe(false)

  await screen.rerender(<CodeBlock className="language-svg">{'<svg>'}</CodeBlock>)
  await expect.poll(() => runtime.svg.started).toBe(true)
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60" role="img" aria-label="Latest illustration"><circle cx="40" cy="30" r="20" /></svg>'
  await screen.rerender(<CodeBlock className="language-svg">{svg}</CodeBlock>)
  runtime.svg.ready.resolve()
  const image = screen.getByRole('img', { name: 'Latest illustration' })
  await expect.element(image).toBeVisible()
  const toggle = screen.getByRole('button', { name: 'SVG', exact: true })
  await toggle.click()
  await expect.element(image).not.toBeInTheDocument()
  await toggle.click()
  await expect.element(image).toBeVisible()
})
