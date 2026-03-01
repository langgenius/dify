// app/components/base/markdown/preprocess.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Helper to (re)load the module with a mocked config value.
 * We need to reset modules because the tested module imports
 * ALLOW_UNSAFE_DATA_SCHEME at top-level.
 */
const loadModuleWithConfig = async (allowDataScheme: boolean) => {
  vi.resetModules()
  vi.doMock('@/config', () => ({ ALLOW_UNSAFE_DATA_SCHEME: allowDataScheme }))
  return await import('./markdown-utils')
}

describe('preprocessLaTeX', () => {
  let mod: typeof import('./markdown-utils')

  beforeEach(async () => {
    // config value doesn't matter for LaTeX preprocessing, mock it false
    mod = await loadModuleWithConfig(false)
  })

  it('returns non-string input unchanged', () => {
    // call with a non-string (bypass TS type system)
    // @ts-expect-error test
    const out = mod.preprocessLaTeX(123)
    expect(out).toBe(123)
  })

  it('converts \\[ ... \\] into $$ ... $$', () => {
    const input = 'This is math: \\[x^2 + 1\\]'
    const out = mod.preprocessLaTeX(input)
    expect(out).toContain('$$x^2 + 1$$')
  })

  it('converts \\( ... \\) into $$ ... $$', () => {
    const input = 'Inline: \\(a+b\\)'
    const out = mod.preprocessLaTeX(input)
    expect(out).toContain('$$a+b$$')
  })

  it('preserves code blocks (does not transform $ inside them)', () => {
    const input = [
      'Some text before',
      '```js',
      'const s = \'$insideCode$\'',
      '```',
      'And outside $math$',
    ].join('\n')

    const out = mod.preprocessLaTeX(input)

    // code block should be preserved exactly (including $ inside)
    expect(out).toContain('```js\nconst s = \'$insideCode$\'\n```')
    // outside inline $math$ should remain intact (function keeps inline $...$)
    expect(out).toContain('$math$')
  })

  it('does not treat escaped dollar \\$ as math delimiter', () => {
    const input = 'Price: \\$5 and math $x$'
    const out = mod.preprocessLaTeX(input)
    // escaped dollar should remain escaped
    expect(out).toContain('\\$5')
    // math should still be present
    expect(out).toContain('$x$')
  })
})

describe('preprocessThinkTag', () => {
  let mod: typeof import('./markdown-utils')

  beforeEach(async () => {
    mod = await loadModuleWithConfig(false)
  })

  it('transforms single <think>...</think> into details with data-think and ENDTHINKFLAG', () => {
    const input = '<think>this is a thought</think>'
    const out = mod.preprocessThinkTag(input)

    expect(out).toContain('<details data-think=true>')
    expect(out).toContain('this is a thought')
    expect(out).toContain('[ENDTHINKFLAG]</details>')
  })

  it('handles multiple <think> tags and inserts newline after closing </details>', () => {
    const input = '<think>one</think>\n<think>two</think>'
    const out = mod.preprocessThinkTag(input)

    // both thoughts become details blocks
    const occurrences = (out.match(/<details data-think=true>/g) || []).length
    expect(occurrences).toBe(2)

    // ensure ENDTHINKFLAG is present twice
    const endCount = (out.match(/\[ENDTHINKFLAG\]<\/details>/g) || []).length
    expect(endCount).toBe(2)
  })
})

describe('customUrlTransform', () => {
  afterEach(() => {
    vi.resetAllMocks()
    vi.resetModules()
  })

  it('allows fragments (#foo) and protocol-relative (//host) and relative paths', async () => {
    const mod = await loadModuleWithConfig(false)
    const t = mod.customUrlTransform

    expect(t('#some-id')).toBe('#some-id')
    expect(t('//example.com/path')).toBe('//example.com/path')
    expect(t('relative/path/to/file')).toBe('relative/path/to/file')
    expect(t('/absolute/path')).toBe('/absolute/path')
  })

  it('allows permitted schemes (http, https, mailto, xmpp, irc/ircs, abbr) case-insensitively', async () => {
    const mod = await loadModuleWithConfig(false)
    const t = mod.customUrlTransform

    expect(t('http://example.com')).toBe('http://example.com')
    expect(t('HTTPS://example.com')).toBe('HTTPS://example.com')
    expect(t('mailto:user@example.com')).toBe('mailto:user@example.com')
    expect(t('xmpp:user@example.com')).toBe('xmpp:user@example.com')
    expect(t('irc:somewhere')).toBe('irc:somewhere')
    expect(t('ircs:secure')).toBe('ircs:secure')
    expect(t('abbr:some-ref')).toBe('abbr:some-ref')
  })

  it('rejects unknown/unsafe schemes (javascript:, ftp:) and returns undefined', async () => {
    const mod = await loadModuleWithConfig(false)
    const t = mod.customUrlTransform

    expect(t('javascript:alert(1)')).toBeUndefined()
    expect(t('ftp://example.com/file')).toBeUndefined()
  })

  it('treats colons inside path/query/fragment as NOT a scheme and returns the original URI', async () => {
    const mod = await loadModuleWithConfig(false)
    const t = mod.customUrlTransform

    // colon after a slash -> part of path
    expect(t('folder/name:withcolon')).toBe('folder/name:withcolon')

    // colon after question mark -> part of query
    expect(t('page?param:http')).toBe('page?param:http')

    // colon after hash -> part of fragment
    expect(t('page#frag:with:colon')).toBe('page#frag:with:colon')
  })

  it('respects ALLOW_UNSAFE_DATA_SCHEME: false blocks data:, true allows data:', async () => {
    const modFalse = await loadModuleWithConfig(false)
    expect(modFalse.customUrlTransform('data:text/plain;base64,SGVsbG8=')).toBeUndefined()

    const modTrue = await loadModuleWithConfig(true)
    expect(modTrue.customUrlTransform('data:text/plain;base64,SGVsbG8=')).toBe('data:text/plain;base64,SGVsbG8=')
  })
})
