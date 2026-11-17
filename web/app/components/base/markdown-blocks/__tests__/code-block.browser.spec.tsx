import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { CodeBlock } from '../code-block'

beforeEach(() => onTestFinished(guardUnexpectedFetch()))

it('keeps fenced source readable with the real syntax highlighter', async () => {
  const source = 'const greeting = "<Hello>";\n  console.log(greeting);'
  const screen = await render(<CodeBlock className="language-javascript">{source}</CodeBlock>)
  await expect.element(screen.getByText('const', { exact: true })).toBeVisible()
  await expect.element(screen.getByText('JavaScript', { exact: true })).toBeVisible()
  expect(screen.getByRole('code').element().textContent).toBe(source)
})

it('switches the real SVG illustration off and back on using the keyboard', async () => {
  const screen = await render(
    <CodeBlock className="language-svg">
      {
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60" role="img" aria-label="Red circle"><circle cx="40" cy="30" r="20" fill="red" /></svg>'
      }
    </CodeBlock>,
  )
  const image = screen.getByRole('img', { name: 'Red circle' })
  await expect.element(image).toBeVisible()
  const toggle = screen.getByRole('button', { name: 'SVG', exact: true })
  toggle.element().focus()
  await userEvent.keyboard(' ')
  await expect.element(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect.element(image).not.toBeInTheDocument()
  await userEvent.keyboard(' ')
  await expect.element(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.element(image).toBeVisible()
  await expect.element(toggle).toHaveFocus()
})

it('renders a streamed chart once its JSON is complete and preserves its drawing after resize', async () => {
  await page.viewport(900, 700)
  const view = (source: string) => (
    <section aria-label="Chart result" style={{ width: '100%' }}>
      <CodeBlock className="language-echarts">{source}</CodeBlock>
    </section>
  )
  const screen = await render(view('{"series":'))
  await expect.element(screen.getByText('Chart loading...')).toBeVisible()
  const option = {
    animation: false,
    aria: { enabled: true, label: { description: 'Revenue chart' } },
    series: [
      { type: 'pie', radius: '70%', data: [{ value: 10, itemStyle: { color: '#ff0000' } }] },
    ],
  }
  await screen.rerender(view(JSON.stringify(option)))
  const chart = screen.getByRole('img', { name: 'Revenue chart' })
  await expect.element(chart).toBeVisible()
  await expect.element(screen.getByText('Chart loading...')).not.toBeInTheDocument()
  // Canvas is the chart SDK's output boundary; pixels prove it rendered the supplied data.
  const canvas = chart.element().querySelector('canvas')!
  const centerPixel = () =>
    Array.from(
      canvas
        .getContext('2d')!
        .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data,
    )
  await expect.poll(centerPixel).toEqual([255, 0, 0, 255])
  const initialWidth = canvas.getBoundingClientRect().width
  await page.viewport(600, 700)
  await expect.poll(() => canvas.getBoundingClientRect().width).toBeLessThan(initialWidth)
  await expect.poll(centerPixel).toEqual([255, 0, 0, 255])
  expect(canvas.getBoundingClientRect().right).toBeLessThanOrEqual(600)
})

it.each(['{a:1}', 'not a json {'])(
  'renders an error drawing instead of leaving malformed chart content loading: %s',
  async (source) => {
    const screen = await render(<CodeBlock className="language-echarts">{source}</CodeBlock>)
    // The real error chart draws its title at the top of the canvas.
    await expect
      .poll(() => {
        const canvas = screen.container.querySelector('canvas')
        if (!canvas) return false
        const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, 40).data
        return pixels.some((value, index) => index % 4 === 3 && value > 0)
      })
      .toBe(true)
    await expect.element(screen.getByText('Chart loading...')).not.toBeInTheDocument()
  },
)
