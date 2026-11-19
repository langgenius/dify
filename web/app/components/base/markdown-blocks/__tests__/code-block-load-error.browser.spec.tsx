import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { CodeBlock } from '../code-block'

// boundary: simulate unavailable external chunks at their package imports.
vi.mock('echarts-for-react', () => {
  throw new Error('Chart chunk unavailable')
})
// boundary: the real music owner encounters a failed notation SDK import.
vi.mock('abcjs', () => {
  throw new Error('Music chunk unavailable')
})
// boundary: the real SVG gallery encounters a failed drawing SDK import.
vi.mock('@svgdotjs/svg.js', () => {
  throw new Error('SVG chunk unavailable')
})
// boundary: simulate a failed lexer package without replacing Dify's highlighter.
vi.mock('@pierre/highlights', () => {
  throw new Error('Lexer chunk unavailable')
})

beforeEach(() => {
  onTestFinished(guardUnexpectedFetch())
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  onTestFinished(() => errors.mockRestore())
})

it.each([
  ['svg', '<svg/>'],
  ['echarts', '{"series":[]}'],
  ['abc', 'X:1\nK:C\nC D E F|'],
])(
  'contains a failed %s runtime without losing the surrounding message',
  async (language, content) => {
    const screen = await render(
      <article aria-label="Assistant message">
        <p>Before the illustration</p>
        <CodeBlock className={`language-${language}`}>{content}</CodeBlock>
        <p>After the illustration</p>
      </article>,
    )
    const message = screen.getByRole('article', { name: 'Assistant message' })
    await expect.element(message.getByText(/Oops! An error occurred/)).toBeVisible()
    await expect.element(message.getByText('Before the illustration')).toBeVisible()
    await expect.element(message.getByText('After the illustration')).toBeVisible()
  },
)

it('leaves source readable after the syntax lexer fails to load', async () => {
  const source = 'const fallback = "still readable";'
  const screen = await render(<CodeBlock className="language-javascript">{source}</CodeBlock>)
  // Wait for the failed import before checking the fallback, which initially has the same source.
  await expect
    .poll(() =>
      vi
        .mocked(console.error)
        .mock.calls.some(([message]) => message === 'Code highlighting failed:'),
    )
    .toBe(true)
  await expect.element(screen.getByRole('code')).toHaveTextContent(source)
  await expect.element(screen.getByText('JavaScript', { exact: true })).toBeVisible()
})
