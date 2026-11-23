import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  analyzeBrowserSpec,
  checkBrowserSpecPolicy,
  isOwnedMockSpecifier,
  isServiceMockSpecifier,
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

  it.each(['@/service/console', '@/service/base', '@/service/use-common'])(
    'treats %s as a service mock',
    (specifier) => {
      expect(isServiceMockSpecifier(specifier)).toBe(true)
    },
  )

  it('resolves relative mock paths before deciding whether they name the service layer', () => {
    expect(
      isServiceMockSpecifier('../../service/console', 'app/components/example.browser.spec.tsx'),
    ).toBe(true)
    expect(
      isServiceMockSpecifier(
        '../../../service/base.ts',
        'app/components/x/example.browser.spec.tsx',
      ),
    ).toBe(true)
    expect(
      isServiceMockSpecifier('../service-fixture', 'app/components/example.browser.spec.tsx'),
    ).toBe(false)
    expect(isServiceMockSpecifier('./service', 'app/components/example.browser.spec.tsx')).toBe(
      false,
    )

    const result = analyzeBrowserSpec(
      'app/components/example.browser.spec.tsx',
      ['// boundary: control the API', "vi.mock('../../service/console', () => ({}))"].join('\n'),
    )
    expect(result.violations).toEqual([
      expect.objectContaining({
        kind: 'service-mock',
        line: 2,
        specifier: '../../service/console',
      }),
    ])
  })

  it('rejects navigation mocks unless the spec is allowlisted', () => {
    const source = [
      "vi.mock('@/next/navigation', () => ({}))",
      "vi.mock('next/navigation', () => ({}))",
      "vi.mock('../../next/navigation', () => ({}))",
    ].join('\n')
    const rejected = analyzeBrowserSpec('app/x/example.browser.spec.tsx', source)
    const allowed = analyzeBrowserSpec('app/x/example.browser.spec.tsx', source, {
      navigationMockAllowlist: [{ path: 'app/x/example.browser.spec.tsx', reason: 'SSR flush' }],
    })

    expect(rejected.violations.map(({ kind, line }) => [kind, line])).toEqual([
      ['navigation-mock', 1],
      ['navigation-mock', 2],
      ['navigation-mock', 3],
    ])
    expect(allowed.violations).toEqual([])
    expect(allowed.observedNavigationAllowance).toBe(true)
  })

  it('rejects service mocks even with a boundary reason', () => {
    const result = analyzeBrowserSpec(
      'app/example.browser.spec.tsx',
      ['// boundary: control the API', "vi.mock('@/service/console', () => ({}))"].join('\n'),
    )

    expect(result.violations).toEqual([
      expect.objectContaining({ kind: 'service-mock', line: 2, specifier: '@/service/console' }),
    ])
  })

  it('reads the type-safe import() form of vi.mock and vi.doMock', () => {
    const result = analyzeBrowserSpec(
      'app/example.browser.spec.tsx',
      [
        "vi.mock(import('@/service/console'), async (importOriginal) => importOriginal())",
        "vi.doMock(import('@/service/base'))",
        "vi.mock(import('../owner'))",
      ].join('\n'),
    )

    expect(result.violations.map(({ kind, line, specifier }) => [kind, line, specifier])).toEqual([
      ['service-mock', 1, '@/service/console'],
      ['service-mock', 2, '@/service/base'],
      ['missing-boundary-comment', 3, '../owner'],
    ])
  })

  it('rejects it.fails only in specs that use the fake API', () => {
    const fails = [
      "it.fails('known bug', async () => {})",
      "test.fails('known bug', () => {})",
      "it.fails.each([1, 2])('known bug %s', async () => {})",
      "test.concurrent.fails('known bug', async () => {})",
      "it.fails.each`value | 1`('known bug $value', async () => {})",
    ]
    const withFake = analyzeBrowserSpec(
      'app/example.browser.spec.tsx',
      ["import { setupFakeApi } from '@/test/fake-api'", ...fails].join('\n'),
    )
    const withoutFake = analyzeBrowserSpec('app/example.browser.spec.tsx', fails.join('\n'))

    expect(withFake.violations.map(({ kind, line }) => [kind, line])).toEqual([
      ['expected-failure-with-fake-api', 2],
      ['expected-failure-with-fake-api', 3],
      ['expected-failure-with-fake-api', 4],
      ['expected-failure-with-fake-api', 5],
      ['expected-failure-with-fake-api', 6],
    ])
    expect(withoutFake.violations).toEqual([])
  })

  it('rejects the fails option and relative fake API imports, but not fails: false', () => {
    const relative = analyzeBrowserSpec(
      'test/__tests__/example.browser.spec.tsx',
      [
        "import { installFakeApi } from '../fake-api'",
        "it('known bug', { fails: true }, async () => {})",
        "describe('known bugs', { fails: true }, () => {})",
        "it.each([1])('known bug %s', { fails: true }, async () => {})",
        "it('passing', { fails: false }, async () => {})",
        "it.fails('known bug', async () => {})",
      ].join('\n'),
    )
    const sourceHelper = analyzeBrowserSpec(
      'features/new-rag/sources/__tests__/example.browser.spec.tsx',
      [
        "import { resetSourceServer } from './source-server'",
        "it.fails('known bug', () => {})",
      ].join('\n'),
    )
    const unrelated = analyzeBrowserSpec(
      'app/example.browser.spec.tsx',
      [
        "import { api } from './fake-api-fixtures'",
        "it('known bug', { fails: true }, () => {})",
      ].join('\n'),
    )

    expect(relative.violations.map(({ kind, line }) => [kind, line])).toEqual([
      ['expected-failure-with-fake-api', 2],
      ['expected-failure-with-fake-api', 3],
      ['expected-failure-with-fake-api', 4],
      ['expected-failure-with-fake-api', 6],
    ])
    expect(sourceHelper.violations.map(({ line }) => line)).toEqual([2])
    expect(unrelated.violations).toEqual([])
  })

  it('rejects raw fetch and XMLHttpRequest stubs, but not other globals', () => {
    const result = analyzeBrowserSpec(
      'app/example.browser.spec.tsx',
      [
        "vi.stubGlobal('fetch', vi.fn())",
        "vi.stubGlobal('XMLHttpRequest', FakeXhr)",
        "vi.spyOn(globalThis, 'fetch')",
        'window.fetch = vi.fn()',
        "vi.stubGlobal('BASE_UI_ANIMATIONS_DISABLED', false)",
        "vi.spyOn(window, 'open')",
      ].join('\n'),
    )

    expect(result.violations.map(({ kind, line }) => [kind, line])).toEqual([
      ['raw-network-stub', 1],
      ['raw-network-stub', 2],
      ['raw-network-stub', 3],
      ['raw-network-stub', 4],
    ])
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
        navigationMockAllowlist: [],
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
        navigationMockAllowlist: [
          { path: 'app/missing.browser.spec.ts', reason: 'legacy missing navigation mock' },
        ],
      })

      expect(result.violations).toEqual([
        expect.objectContaining({ kind: 'missing-boundary-comment' }),
        expect.objectContaining({ kind: 'oversized-spec' }),
      ])
      expect(result.staleAllowances).toEqual([
        'stale mock allowlist: app/missing.browser.spec.ts :: ../missing #1',
        'stale line allowlist: app/missing.browser.spec.ts',
        'stale navigation mock allowlist: app/missing.browser.spec.ts',
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
