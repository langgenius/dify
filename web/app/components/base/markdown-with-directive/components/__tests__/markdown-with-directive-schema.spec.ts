import { validateDirectiveProps } from '../markdown-with-directive-schema'

describe('markdown-with-directive-schema', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts a card item with an HTTPS icon', () => {
    expect(
      validateDirectiveProps('withiconcarditem', { icon: 'https://example.com/icon.png' }),
    ).toBe(true)
  })

  it.each([
    ['unknown-directive', { className: 'custom-list' }],
    ['withiconcarditem', { icon: 'ftp://example.com/icon.png' }],
    ['withiconcardlist', { className: 'custom-list', extra: 'not-allowed' }],
  ] satisfies [string, Record<string, string>][])(
    'rejects unsupported attributes for %s',
    (name, attributes) => {
      expect(validateDirectiveProps(name, attributes)).toBe(false)
    },
  )
})
