import { renderToStaticMarkup } from 'react-dom/server'
import * as shikiCore from 'shiki/core'
import { highlightCode } from '../shiki-highlight'

// Mock the singleton accessor so tests can assert that the WASM engine is not
// loaded for plain-text fences while still letting supported-language tests
// observe a real `getSingletonHighlighter` invocation.
const { mockGetSingletonHighlighter } = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockGetSingletonHighlighter: vi.fn() as any,
}))

vi.mock('shiki/core', async (importOriginal) => {
  const actual = await importOriginal<typeof shikiCore>()
  const realCreateSingletonShorthands = actual.createSingletonShorthands
  return {
    ...actual,
    createSingletonShorthands: (factory: Parameters<typeof realCreateSingletonShorthands>[0]) => {
      const real = realCreateSingletonShorthands(factory)
      // Wrap real `getSingletonHighlighter` so tests can observe invocations.
      const realGet = real.getSingletonHighlighter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapped: any = (...args: Parameters<typeof realGet>) => {
        mockGetSingletonHighlighter(...args)
        return realGet(...args)
      }
      return { getSingletonHighlighter: wrapped }
    },
  }
})

describe('README code highlighting', () => {
  beforeEach(() => {
    mockGetSingletonHighlighter.mockReset()
  })

  it.each(['github-light', 'github-dark'] as const)('highlights dotenv with %s', async (theme) => {
    const code = 'OPENAI_API_KEY=your-api-key\n# OPENAI_ORGANIZATION=org-id'
    const result = renderToStaticMarkup(await highlightCode({ code, language: 'dotenv', theme }))

    expect(result).toContain('OPENAI_API_KEY')
    expect(result).toContain('your-api-key')
    expect(result).toContain('OPENAI_ORGANIZATION=org-id')
    expect(result).toContain('<span style="color:')
    expect(mockGetSingletonHighlighter).toHaveBeenCalledTimes(1)
  })

  it('renders unsupported languages as readable, escaped plain text', async () => {
    const code = '<custom>example</custom>'
    const result = renderToStaticMarkup(
      await highlightCode({
        code,
        language: 'unknown-readme-language',
        theme: 'github-light',
      }),
    )

    expect(result).toContain('&lt;custom&gt;example&lt;/custom&gt;')
    expect(mockGetSingletonHighlighter).not.toHaveBeenCalled()
  })

  it('renders an empty language fence as escaped plain text without loading the WASM engine', async () => {
    const code = 'plain line one\nplain line two'
    const result = renderToStaticMarkup(
      await highlightCode({ code, language: '', theme: 'github-light' }),
    )

    expect(result).toContain('plain line one')
    expect(result).toContain('plain line two')
    expect(mockGetSingletonHighlighter).not.toHaveBeenCalled()
  })

  it('renders a whitespace-only language fence as escaped plain text without loading the WASM engine', async () => {
    const code = 'no language here'
    const result = renderToStaticMarkup(
      await highlightCode({ code, language: '   ', theme: 'github-light' }),
    )

    expect(result).toContain('no language here')
    expect(mockGetSingletonHighlighter).not.toHaveBeenCalled()
  })

  it('renders an unsupported language as escaped plain text without loading the WASM engine', async () => {
    const code = 'function hello() { return 42 }'
    const result = renderToStaticMarkup(
      await highlightCode({ code, language: 'made-up-language', theme: 'github-light' }),
    )

    expect(result).toContain('function hello() { return 42 }')
    expect(mockGetSingletonHighlighter).not.toHaveBeenCalled()
  })

  it('escapes HTML-sensitive characters in plain-text fences', async () => {
    const code = 'a < b && b > c & "x"'
    const result = renderToStaticMarkup(
      await highlightCode({ code, language: 'text', theme: 'github-light' }),
    )

    expect(result).toContain('a &lt; b &amp;&amp; b &gt; c &amp; &quot;x&quot;')
    expect(mockGetSingletonHighlighter).not.toHaveBeenCalled()
  })

  it('preserves highlighting for bundled language aliases', async () => {
    const result = renderToStaticMarkup(
      await highlightCode({
        code: 'const count = 1',
        language: 'js',
        theme: 'github-light',
      }),
    )

    expect(result).toContain('const')
    expect(result).toContain('<span style="color:')
    expect(mockGetSingletonHighlighter).toHaveBeenCalledTimes(1)
  })
})
