import type { ThemedToken } from '@pierre/highlights'
import type { CSSProperties, JSX } from 'react'
import { Fragment } from 'react'

const themes = {
  'github-dark': () => import('@pierre/highlights/themes/github-dark'),
  'github-light': () => import('@pierre/highlights/themes/github-light'),
}

export type CodeTheme = keyof typeof themes

// Highlights bundles a fixed lexer set. Map README fence names it lacks to a
// close lexer; other unsupported names render as plain text.
const languageAliases: Record<string, string> = {
  dotenv: 'bash',
}

const plainLanguages = new Set(['', 'plain', 'plaintext', 'text', 'txt'])

type HighlightCodeOptions = {
  code: string
  language: string
  theme: CodeTheme
}

type CodeLine = Pick<ThemedToken, 'content' | 'color' | 'fontStyle'>[]

const getTokenStyle = ({ color, fontStyle = 0 }: CodeLine[number]): CSSProperties | undefined => {
  if (!color && !fontStyle) return undefined
  return {
    color,
    // Highlights only emits Shiki's italic (1) and bold (2) flags.
    fontStyle: fontStyle & 1 ? 'italic' : undefined,
    fontWeight: fontStyle & 2 ? 'bold' : undefined,
  }
}

const renderLines = (lines: CodeLine[], style?: CSSProperties) => (
  <pre style={style}>
    <code>
      {lines.map((tokens, lineIndex) => (
        // oxlint-disable-next-line react/no-array-index-key -- Lines are positional and re-render together.
        <Fragment key={lineIndex}>
          {lineIndex > 0 && '\n'}
          {/* The code-block gutter uses .line::before for its line numbers. */}
          <span className="line">
            {tokens.map((token, tokenIndex) => (
              // oxlint-disable-next-line react/no-array-index-key -- Tokens are positional within their line.
              <span key={tokenIndex} style={getTokenStyle(token)}>
                {token.content}
              </span>
            ))}
          </span>
        </Fragment>
      ))}
    </code>
  </pre>
)

const renderPlainText = (code: string) =>
  renderLines(code.split(/\r?\n/).map((content) => [{ content }]))

export const highlightCode = async ({
  code,
  language,
  theme,
}: HighlightCodeOptions): Promise<JSX.Element> => {
  const normalizedLanguage = language.trim().toLowerCase()
  const lang = languageAliases[normalizedLanguage] ?? normalizedLanguage

  // Plain text does not need syntax highlighting, so skip loading the
  // WebAssembly lexers for it (see #42943).
  if (plainLanguages.has(lang)) return renderPlainText(code)

  const [{ codeToTokens, isSupportedLanguage }, { default: themeDefinition }] = await Promise.all([
    import('@pierre/highlights'),
    themes[theme](),
  ])

  // README fences may name languages outside the bundled lexers. Keep them
  // readable instead of letting Highlights throw a RangeError.
  if (!isSupportedLanguage(lang)) return renderPlainText(code)

  const { tokens, fg, bg } = codeToTokens(code, { lang, theme: themeDefinition })
  return renderLines(tokens, { backgroundColor: bg, color: fg })
}
