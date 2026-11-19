import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  analyzeBrowserSpec,
  checkBrowserSpecPolicy,
  isOwnedMockSpecifier,
  MAX_BROWSER_SPEC_LINES,
  reportPolicyResult,
  runBrowserSpecPolicy,
} from '../check-browser-spec-policy'

describe('Browser spec policy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

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

  it('ignores non-mock calls and non-literal mock specifiers', () => {
    const result = analyzeBrowserSpec(
      'app/example.browser.spec.tsx',
      [
        "jest.mock('../owner')",
        "vi.spyOn(console, 'log')",
        'vi.mock(getOwnerSpecifier())',
        'vi.mock()',
      ].join('\n'),
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

  it('scans Browser specs recursively while ignoring generated and unrelated files', () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'browser-policy-'))
    const appDirectory = join(webRoot, 'app', 'journey')
    const ignoredDirectory = join(webRoot, 'node_modules', 'fixture')
    mkdirSync(appDirectory, { recursive: true })
    mkdirSync(ignoredDirectory, { recursive: true })
    writeFileSync(
      join(appDirectory, 'journey.browser.spec.tsx'),
      [
        "vi.mock('../owner', () => ({}))",
        '// boundary: browser-external navigation runtime',
        "vi.doMock('@/hooks/use-navigation', () => ({}))",
      ].join('\n'),
    )
    writeFileSync(join(appDirectory, 'not-a-browser-spec.test.ts'), "vi.mock('../ignored')")
    writeFileSync(join(ignoredDirectory, 'ignored.browser.spec.ts'), "vi.mock('../ignored')")

    try {
      const result = checkBrowserSpecPolicy(webRoot, {
        mockAllowlist: [
          {
            path: 'app/journey/journey.browser.spec.tsx',
            specifier: '../owner',
            occurrence: 1,
            reason: 'legacy owner mock',
          },
        ],
        lineAllowlist: [],
      })

      expect(result).toEqual({ violations: [], staleAllowances: [] })
    } finally {
      rmSync(webRoot, { recursive: true, force: true })
    }
  })

  it('reports new violations and every stale exact allowance', () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'browser-policy-'))
    const appDirectory = join(webRoot, 'app')
    mkdirSync(appDirectory)
    writeFileSync(
      join(appDirectory, 'journey.browser.spec.ts'),
      ["vi.mock('../owner', () => ({}))", ...Array.from({ length: 500 }, () => '// line')].join(
        '\n',
      ),
    )

    try {
      const result = checkBrowserSpecPolicy(webRoot, {
        mockAllowlist: [
          {
            path: 'app/missing.browser.spec.ts',
            specifier: '../missing',
            occurrence: 1,
            reason: 'legacy missing owner',
          },
        ],
        lineAllowlist: [
          { path: 'app/missing.browser.spec.ts', reason: 'legacy missing oversized suite' },
        ],
      })

      expect(result.violations).toEqual([
        expect.objectContaining({ kind: 'missing-boundary-comment' }),
        expect.objectContaining({ kind: 'oversized-spec' }),
      ])
      expect(result.staleAllowances).toEqual([
        'stale mock allowlist: app/missing.browser.spec.ts :: ../missing #1',
        'stale line allowlist: app/missing.browser.spec.ts',
      ])
    } finally {
      rmSync(webRoot, { recursive: true, force: true })
    }
  })

  it('prints a concise pass or failure report', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(reportPolicyResult({ violations: [], staleAllowances: [] })).toBe(true)
    expect(log).toHaveBeenCalledWith('Browser spec policy passed.')

    expect(
      reportPolicyResult({
        violations: [
          {
            kind: 'missing-boundary-comment',
            path: 'app/example.browser.spec.ts',
            line: 3,
            message: 'owned module needs a boundary reason',
          },
          {
            kind: 'oversized-spec',
            path: 'features/large.browser.spec.ts',
            message: '501 lines exceeds the limit',
          },
        ],
        staleAllowances: ['stale line allowlist: app/old.browser.spec.ts'],
      }),
    ).toBe(false)
    expect(error.mock.calls).toEqual([
      ['Browser spec policy failed:'],
      ['- app/example.browser.spec.ts:3: owned module needs a boundary reason'],
      ['- features/large.browser.spec.ts: 501 lines exceeds the limit'],
      ['- stale line allowlist: app/old.browser.spec.ts'],
    ])
    expect(process.exitCode).toBe(1)
  })

  it('runs the repository policy through the command entry point', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    expect(runBrowserSpecPolicy()).toBe(true)
    expect(log).toHaveBeenCalledWith('Browser spec policy passed.')
  })
})
