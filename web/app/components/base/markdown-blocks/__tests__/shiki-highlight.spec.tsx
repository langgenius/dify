import type { createSingletonShorthands } from 'shiki/core'
import type * as shikiCore from 'shiki/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { highlightCode } from '../shiki-highlight'

// `shiki/core` only exposes `getSingletonHighlighter` as a property of the
// shorthand bundle returned by `createSingletonShorthands`, not as a top-level
// symbol. Derive the accessor signature from the return type so wrapped calls
// remain correctly typed without importing a non-exported name.
type SingletonAccessor = ReturnType<typeof createSingletonShorthands>['getSingletonHighlighter']

// Mock the singleton accessor so tests can assert that the WASM engine is not
// loaded for plain-text fences while still letting supported-language tests
// observe a real `getSingletonHighlighter` invocation.
const { mockGetSingletonHighlighter } = vi.hoisted(() => ({
  mockGetSingletonHighlighter: vi.fn(),
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
      const wrapped: SingletonAccessor = (...args: Parameters<typeof realGet>) => {
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

  it.each(['\n', '\r\n'])(
    'preserves indentation and blank lines with %j line endings',
    async (lineEnding) => {
      const lines = ['', '  <custom>example</custom>', '', '\tindented', '']
      const result = renderToStaticMarkup(
        await highlightCode({
          code: lines.join(lineEnding),
          language: 'text',
          theme: 'github-light',
        }),
      )
      const document = new DOMParser().parseFromString(result, 'text/html')

      expect(document.querySelector('code')?.textContent).toBe(lines.join('\n'))
      expect(document.querySelector('custom')).toBeNull()
      expect(mockGetSingletonHighlighter).not.toHaveBeenCalled()
    },
  )

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
