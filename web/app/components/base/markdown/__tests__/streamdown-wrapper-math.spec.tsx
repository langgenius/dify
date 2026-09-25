import type { PropsWithChildren } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

const settings = vi.hoisted(() => ({ singleDollar: false }))
vi.mock('@/config', () => ({
  ALLOW_INLINE_STYLES: false,
  ALLOW_UNSAFE_DATA_SCHEME: false,
  get ENABLE_SINGLE_DOLLAR_LATEX() {
    return settings.singleDollar
  },
}))
vi.mock('@/app/components/base/markdown-blocks', () => ({
  AudioBlock: () => null,
  Img: () => null,
  Link: ({ children }: PropsWithChildren) => <a href="#test">{children}</a>,
  MarkdownButton: () => null,
  MarkdownForm: () => null,
  Paragraph: ({ children }: PropsWithChildren) => <p>{children}</p>,
  PluginImg: () => null,
  PluginParagraph: () => null,
  ThinkBlock: () => null,
  VideoBlock: () => null,
}))
vi.mock('@/app/components/base/markdown-blocks/code-block', () => ({
  CodeBlock: ({ children }: PropsWithChildren) => <code>{children}</code>,
}))

let release: () => void
let load: ReturnType<typeof vi.fn<() => Promise<typeof import('../math-plugins')>>>

beforeEach(() => {
  vi.resetModules()
  settings.singleDollar = false
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  load = vi.fn(async () => {
    await gate
    return vi.importActual<typeof import('../math-plugins')>('../math-plugins')
  })
  vi.doMock('../math-plugins', () => load())
})

async function finishLoading() {
  await waitFor(() => expect(load).toHaveBeenCalled())
  await act(async () => {
    release()
    await Promise.allSettled(load.mock.results.map((result) => result.value))
    await vi.dynamicImportSettled()
  })
}

it('defers math for prose and renders the latest streamed formulas when loading completes', async () => {
  const { default: Wrapper } = await import('../streamdown-wrapper')
  const { container, rerender } = render(<Wrapper latexContent="A plain answer." />)
  expect(screen.getByText('A plain answer.')).toBeInTheDocument()
  expect(load).not.toHaveBeenCalled()
  rerender(<Wrapper latexContent="A plain answer. Now $$x" isAnimating />)
  await waitFor(() => expect(load).toHaveBeenCalledOnce())
  rerender(<Wrapper latexContent={'A plain answer. Now $$x+1$$.\n\n$$\ny^2\n$$'} />)
  expect(container.textContent).toContain('x+1')
  expect(container.querySelector('math')).toBeNull()
  await finishLoading()
  await waitFor(() => expect(container.querySelectorAll('math')).toHaveLength(2))
  expect(container.querySelector('annotation')?.textContent).toBe('x+1')
  expect(container.querySelector('math[display="block"]')).not.toBeNull()
})

it.each([false, true])('preserves the single-dollar option (%s)', async (enabled) => {
  settings.singleDollar = enabled
  const { default: Wrapper } = await import('../streamdown-wrapper')
  const { container } = render(<Wrapper latexContent="$x+1$" mode="static" />)
  await finishLoading()
  await waitFor(() => expect(container.querySelectorAll('math')).toHaveLength(enabled ? 1 : 0))
  if (!enabled) expect(container.textContent).toBe('$x+1$')
})

it('preserves escaped dollars and formulas inside ordinary code', async () => {
  settings.singleDollar = true
  const { default: Wrapper } = await import('../streamdown-wrapper')
  const { container } = render(
    <Wrapper
      latexContent={'Escaped \\$x\\$. Inline `$$y$$`.\n\n```text\n$$z$$\n```'}
      mode="static"
    />,
  )
  await finishLoading()
  expect(container.querySelector('math')).toBeNull()
  expect(container.textContent).toContain('Escaped $x$.')
  expect(container.textContent).toContain('$$y$$')
  expect(container.textContent).toContain('$$z$$')
})

it.each(['```math\nx+1\n```', '~~~math\nx+1\n~~~', '<code class="language-math">x+1</code>'])(
  'loads math for non-dollar syntax: %s',
  async (content) => {
    const { default: Wrapper } = await import('../streamdown-wrapper')
    const { container } = render(<Wrapper latexContent={content} mode="static" />)
    await finishLoading()
    await waitFor(() => expect(container.querySelector('annotation')?.textContent).toContain('x+1'))
  },
)

it('loads for a custom remark plugin that produces math from plain text', async () => {
  const { default: Wrapper } = await import('../streamdown-wrapper')
  const remarkFormula = () => (tree: { children: unknown[] }) => {
    tree.children = [
      {
        type: 'paragraph',
        children: [
          {
            type: 'inlineMath',
            value: 'x+1',
            data: {
              hName: 'code',
              hProperties: { className: ['language-math', 'math-inline'] },
              hChildren: [{ type: 'text', value: 'x+1' }],
            },
          },
        ],
      },
    ]
  }
  const { container } = render(
    <Wrapper latexContent="formula" remarkPlugins={[remarkFormula]} mode="static" />,
  )
  await finishLoading()
  expect(container.querySelector('annotation')?.textContent).toBe('x+1')
})

it('keeps invalid formulas readable using the original KaTeX error handling', async () => {
  const { default: Wrapper } = await import('../streamdown-wrapper')
  const { container } = render(<Wrapper latexContent={'$$\\notARealCommand$$'} mode="static" />)
  await finishLoading()
  expect(container.textContent).toContain('\\notARealCommand')
  expect(container.querySelector('math')?.textContent).toContain('\\notARealCommand')
})

it('hydrates consistently after another instance has loaded math', async () => {
  const { default: Wrapper } = await import('../streamdown-wrapper')
  const first = render(<Wrapper latexContent="$$x$$" mode="static" />)
  await finishLoading()
  expect(first.container.querySelector('math')).not.toBeNull()
  const content = <Wrapper latexContent="$$y$$" mode="static" />
  const container = document.createElement('div')
  container.innerHTML = renderToString(content)
  const onRecoverableError = vi.fn()
  let root: ReturnType<typeof hydrateRoot>
  await act(async () => {
    root = hydrateRoot(container, content, { onRecoverableError })
  })
  expect(container.querySelector('annotation')?.textContent).toBe('y')
  expect(onRecoverableError).not.toHaveBeenCalled()
  await act(async () => {
    root.unmount()
  })
})

it('keeps text readable on a chunk error and allows another mount to retry', async () => {
  load.mockRejectedValueOnce(new Error('Chunk unavailable'))
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const { default: Wrapper } = await import('../streamdown-wrapper')
    const first = render(<Wrapper latexContent="Formula $$x$$" mode="static" />)
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(first.container.textContent).toBe('Formula $$x$$')
    first.unmount()
    // Vitest caches rejected mock factories; a network fetch can be retried.
    vi.doMock('../math-plugins', () => load())
    const second = render(<Wrapper latexContent="Formula $$y$$" mode="static" />)
    await finishLoading()
    await waitFor(() => expect(second.container.querySelector('annotation')?.textContent).toBe('y'))
  } finally {
    error.mockRestore()
  }
})
