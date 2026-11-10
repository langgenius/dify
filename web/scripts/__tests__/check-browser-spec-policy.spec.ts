import { describe, expect, it } from 'vite-plus/test'
import {
  analyzeBrowserSpec,
  isOwnedMockSpecifier,
  MAX_BROWSER_SPEC_LINES,
} from '../check-browser-spec-policy'

describe('Browser spec policy', () => {
  it.each([
    './fixture',
    '../owner',
    '@/app/components/dialog',
    '@/features/new-rag/state',
    '@/context/app-context',
    '@/hooks/use-clipboard',
    '#i18n',
    'react-i18next',
  ])('classifies %s as an owned path', (specifier) => {
    expect(isOwnedMockSpecifier(specifier)).toBe(true)
  })

  it.each(['next/navigation', '@/service/base', 'echarts', 'date-fns'])(
    'leaves %s outside the owned-path guard',
    (specifier) => {
      expect(isOwnedMockSpecifier(specifier)).toBe(false)
    },
  )

  it('requires a nonempty boundary reason on the immediately preceding line', () => {
    const result = analyzeBrowserSpec(
      'app/example.browser.spec.tsx',
      [
        '// boundary: the real owner requires a browser-external engine',
        "vi.mock('../owner', () => ({}))",
        '',
        '// boundary:',
        "vi.doMock('@/hooks/use-owner', () => ({}))",
      ].join('\n'),
    )

    expect(result.violations).toEqual([
      expect.objectContaining({
        kind: 'missing-boundary-comment',
        line: 5,
        message: expect.stringContaining('@/hooks/use-owner'),
      }),
    ])
  })

  it('ignores comments and string contents that merely mention vi.mock', () => {
    const result = analyzeBrowserSpec(
      'app/example.browser.spec.tsx',
      ["// vi.mock('../commented')", 'const example = "vi.mock(\'../string\')"'].join('\n'),
    )

    expect(result.violations).toEqual([])
  })

  it('allows only the exact occurrence recorded as existing debt', () => {
    const path = 'app/example.browser.spec.tsx'
    const result = analyzeBrowserSpec(
      path,
      ["vi.mock('../owner', () => ({}))", "vi.mock('../owner', () => ({}))"].join('\n'),
      {
        mockAllowlist: [
          { path, specifier: '../owner', occurrence: 1, reason: 'first legacy journey' },
        ],
      },
    )

    expect(result.observedMockAllowances.size).toBe(1)
    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'missing-boundary-comment', line: 2 }),
    ])
  })

  it('makes an allowance stale after the mock gains its boundary reason', () => {
    const path = 'app/example.browser.spec.tsx'
    const result = analyzeBrowserSpec(
      path,
      ['// boundary: browser-external engine', "vi.mock('../owner', () => ({}))"].join('\n'),
      {
        mockAllowlist: [{ path, specifier: '../owner', occurrence: 1, reason: 'legacy journey' }],
      },
    )

    expect(result.violations).toEqual([])
    expect(result.observedMockAllowances.size).toBe(0)
  })

  it('fails only after the 500-line ceiling and supports an exact legacy allowance', () => {
    const path = 'features/example.browser.spec.tsx'
    const source = Array.from({ length: MAX_BROWSER_SPEC_LINES + 1 }, () => '// line').join('\n')
    expect(analyzeBrowserSpec(path, source).violations).toEqual([
      expect.objectContaining({ kind: 'oversized-spec' }),
    ])
    expect(
      analyzeBrowserSpec(path, source, {
        lineAllowlist: [{ path, reason: 'legacy mixed-domain suite' }],
      }).violations,
    ).toEqual([])
  })
})
