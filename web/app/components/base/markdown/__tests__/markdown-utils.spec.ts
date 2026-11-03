/**
 * Helper to (re)load the module with a mocked config value.
 * We need to reset modules because the tested module imports
 * ALLOW_UNSAFE_DATA_SCHEME at top-level.
 */
const loadModuleWithConfig = async (allowDataScheme: boolean) => {
  vi.resetModules()
  vi.doMock('@/config', () => ({ ALLOW_UNSAFE_DATA_SCHEME: allowDataScheme }))
  return await import('../markdown-utils')
}

describe('preprocessLaTeX', () => {
  let mod: typeof import('../markdown-utils')

  beforeEach(async () => {
    // config value doesn't matter for LaTeX preprocessing, mock it false
    mod = await loadModuleWithConfig(false)
  })

  it('converts \\[ ... \\] into $$ ... $$', () => {
    const input = 'This is math: \\[x^2 + 1\\]'
    const out = mod.preprocessLaTeX(input)
    expect(out).toContain('$$x^2 + 1$$')
  })

  it('converts multiline \\[ ... \\] blocks into $$ ... $$', () => {
    const input = 'Block:\n\\[\na+b=c\n\\]'
    const out = mod.preprocessLaTeX(input)
    expect(out).toContain('$$\na+b=c\n$$')
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
      "const s = '$insideCode$'",
      '```',
      'And outside $math$',
    ].join('\n')

    const out = mod.preprocessLaTeX(input)

    // code block should be preserved exactly (including $ inside)
    expect(out).toContain("```js\nconst s = '$insideCode$'\n```")
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
  let mod: typeof import('../markdown-utils')

  beforeEach(async () => {
    mod = await loadModuleWithConfig(false)
  })

  it('wraps reasoning before an orphan closing think tag and leaves the answer outside', () => {
    const input = 'reasoning\n</think>\nanswer'

    expect(mod.preprocessThinkTag(input)).toBe(
      '<details data-think=true>\nreasoning\n[ENDTHINKFLAG]</details>\nanswer',
    )
  })

  it('preserves the exact output of a paired think block followed by an answer', () => {
    const input = '<think>reasoning</think>answer'

    expect(mod.preprocessThinkTag(input)).toBe(
      '<details data-think=true>\nreasoning\n[ENDTHINKFLAG]</details>\nanswer',
    )
  })

  it('removes an extra closing think tag after a completed thought without closing details again', () => {
    const input = '<think>reasoning</think>answer</think>more'

    expect(mod.preprocessThinkTag(input)).toBe(
      '<details data-think=true>\nreasoning\n[ENDTHINKFLAG]</details>\nanswermore',
    )
  })

  it('preserves the exact output of an in-flight thought without a completion flag', () => {
    expect(mod.preprocessThinkTag('<think>reasoning')).toBe(
      '<details data-think=true>\nreasoning</details>',
    )
  })

  it('keeps text before a paired think block outside the details', () => {
    expect(mod.preprocessThinkTag('intro <think>r</think>ans')).toBe(
      'intro <details data-think=true>\nr\n[ENDTHINKFLAG]</details>\nans',
    )
  })

  it('wraps leading orphan reasoning even when a later paired think block exists', () => {
    expect(mod.preprocessThinkTag('r1</think>a1\n<think>r2</think>a2')).toBe(
      '<details data-think=true>\nr1\n[ENDTHINKFLAG]</details>\na1\n<details data-think=true>\nr2\n[ENDTHINKFLAG]</details>\na2',
    )
  })

  it('returns content without think tags unchanged', () => {
    expect(mod.preprocessThinkTag('hello **world**')).toBe('hello **world**')
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

  it('normalizes repeated think tags to a single details pair', () => {
    const input = '<think><think>deep</think></think>'
    const out = mod.preprocessThinkTag(input)

    expect((out.match(/<details data-think=true>/g) || []).length).toBe(1)
    expect((out.match(/\[ENDTHINKFLAG\]<\/details>/g) || []).length).toBe(1)
  })

  it('closes a dangling <think> so the details block is well-formed', () => {
    const input = '<think>planning the tool call'
    const out = mod.preprocessThinkTag(input)

    expect((out.match(/<details data-think=true>/g) || []).length).toBe(1)
    expect((out.match(/\[ENDTHINKFLAG\]<\/details>/g) || []).length).toBe(0)
    expect(out).toContain('planning the tool call')
  })

  it('closes the previous think before a second unclosed <think>', () => {
    const input = '<think>first pass\n<think>second pass\nreply'
    const out = mod.preprocessThinkTag(input)

    expect((out.match(/<details data-think=true>/g) || []).length).toBe(2)
    expect((out.match(/\[ENDTHINKFLAG\]<\/details>/g) || []).length).toBe(1)
    expect(out.indexOf('first pass')).toBeLessThan(out.indexOf('[ENDTHINKFLAG]'))
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
    expect(modTrue.customUrlTransform('data:text/plain;base64,SGVsbG8=')).toBe(
      'data:text/plain;base64,SGVsbG8=',
    )
  })
})
