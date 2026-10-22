import type * as highlights from '@pierre/highlights'
import { renderToStaticMarkup } from 'react-dom/server'
import { highlightCode } from '../code-highlight'

// Wrap the real tokenizer so tests can assert that plain-text and unsupported
// fences never reach the WebAssembly lexers.
const { mockCodeToTokens } = vi.hoisted(() => ({
  mockCodeToTokens: vi.fn(),
}))

vi.mock('@pierre/highlights', async (importOriginal) => {
  const actual = await importOriginal<typeof highlights>()
  return {
    ...actual,
    codeToTokens: (...args: Parameters<typeof actual.codeToTokens>) => {
      mockCodeToTokens(...args)
      return actual.codeToTokens(...args)
    },
  }
})

describe('README code highlighting', () => {
  beforeEach(() => {
    mockCodeToTokens.mockReset()
  })

  it.each(['github-light', 'github-dark'] as const)('highlights dotenv with %s', async (theme) => {
    const code = 'OPENAI_API_KEY=your-api-key\n# OPENAI_ORGANIZATION=org-id'
    const result = renderToStaticMarkup(await highlightCode({ code, language: 'dotenv', theme }))

    expect(result).toContain('OPENAI_API_KEY')
    expect(result).toContain('your-api-key')
    expect(result).toContain('OPENAI_ORGANIZATION=org-id')
    expect(result).toContain('<span style="color:')
    expect(mockCodeToTokens).toHaveBeenCalledTimes(1)
    expect(mockCodeToTokens.mock.calls[0]![1]).toMatchObject({ lang: 'bash' })
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
    expect(mockCodeToTokens).not.toHaveBeenCalled()
  })

  it.each(['', '   ', 'text', 'TXT'])(
    'renders the plain language %j without tokenizing',
    async (language) => {
      const code = 'plain line one\nplain line two'
      const result = renderToStaticMarkup(
        await highlightCode({ code, language, theme: 'github-light' }),
      )

      expect(result).toContain('plain line one')
      expect(result).toContain('plain line two')
      expect(mockCodeToTokens).not.toHaveBeenCalled()
    },
  )

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
      expect(document.querySelectorAll('.line')).toHaveLength(lines.length)
      expect(document.querySelector('custom')).toBeNull()
    },
  )

  it.each(['\n', '\r\n'])(
    'renders one line element per highlighted line with %j line endings',
    async (lineEnding) => {
      const lines = ['const a = 1', '', '  const b = a']
      const result = renderToStaticMarkup(
        await highlightCode({
          code: lines.join(lineEnding),
          language: 'ts',
          theme: 'github-dark',
        }),
      )
      const document = new DOMParser().parseFromString(result, 'text/html')

      expect(document.querySelector('code')?.textContent).toBe(lines.join('\n'))
      expect(document.querySelectorAll('.line')).toHaveLength(lines.length)
    },
  )

  it('escapes HTML-sensitive characters in plain-text fences', async () => {
    const code = 'a < b && b > c & "x"'
    const result = renderToStaticMarkup(
      await highlightCode({ code, language: 'text', theme: 'github-light' }),
    )

    expect(result).toContain('a &lt; b &amp;&amp; b &gt; c &amp; &quot;x&quot;')
  })

  it('escapes HTML-sensitive characters in highlighted fences', async () => {
    const result = renderToStaticMarkup(
      await highlightCode({
        code: '<div class="x">&amp;</div>',
        language: 'html',
        theme: 'github-light',
      }),
    )

    expect(result).not.toContain('<div class="x">')
    expect(result).toContain('&lt;')
    expect(result).toContain('&amp;amp;')
  })

  it.each(['js', 'Python', 'go'])('highlights the bundled language %s', async (language) => {
    const result = renderToStaticMarkup(
      await highlightCode({
        code: 'const count = 1',
        language,
        theme: 'github-light',
      }),
    )

    expect(result).toContain('count')
    expect(result).toContain('<span style="color:')
    expect(mockCodeToTokens).toHaveBeenCalledTimes(1)
  })
})
