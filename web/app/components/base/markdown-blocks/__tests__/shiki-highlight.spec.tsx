import { renderToStaticMarkup } from 'react-dom/server'
import { highlightCode } from '../shiki-highlight'

describe('README code highlighting', () => {
  it.each(['github-light', 'github-dark'] as const)('highlights dotenv with %s', async (theme) => {
    const code = 'OPENAI_API_KEY=your-api-key\n# OPENAI_ORGANIZATION=org-id'
    const result = renderToStaticMarkup(await highlightCode({ code, language: 'dotenv', theme }))

    expect(result).toContain('OPENAI_API_KEY')
    expect(result).toContain('your-api-key')
    expect(result).toContain('OPENAI_ORGANIZATION=org-id')
    expect(result).toContain('<span style="color:')
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
  })
})
