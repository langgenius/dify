import {
  getCoverageStats,
  isRelevantTestFile,
  isTrackedComponentSourceFile,
  loadTrackedCoverageEntries,
} from '../scripts/components-coverage-common.mjs'

describe('components coverage common helpers', () => {
  it('should identify tracked component source files and relevant tests', () => {
    const excludedComponentCoverageFiles = new Set([
      'web/app/components/share/types.ts',
    ])

    expect(isTrackedComponentSourceFile('web/app/components/share/index.tsx', excludedComponentCoverageFiles)).toBe(true)
    expect(isTrackedComponentSourceFile('web/app/components/share/types.ts', excludedComponentCoverageFiles)).toBe(false)
    expect(isTrackedComponentSourceFile('web/app/components/provider/index.tsx', excludedComponentCoverageFiles)).toBe(false)

    expect(isRelevantTestFile('web/__tests__/share/text-generation-run-once-flow.test.tsx')).toBe(true)
    expect(isRelevantTestFile('web/app/components/share/__tests__/index.spec.tsx')).toBe(true)
    expect(isRelevantTestFile('web/utils/format.spec.ts')).toBe(false)
  })

  it('should load only tracked coverage entries from mixed coverage paths', () => {
    const context = {
      excludedComponentCoverageFiles: new Set([
        'web/app/components/share/types.ts',
      ]),
      repoRoot: '/repo',
      webRoot: '/repo/web',
    }
    const coverage = {
      '/repo/web/app/components/provider/index.tsx': {
        path: '/repo/web/app/components/provider/index.tsx',
        statementMap: { 0: { start: { line: 1 }, end: { line: 1 } } },
        s: { 0: 1 },
      },
      'app/components/share/index.tsx': {
        path: 'app/components/share/index.tsx',
        statementMap: { 0: { start: { line: 2 }, end: { line: 2 } } },
        s: { 0: 1 },
      },
      'app/components/share/types.ts': {
        path: 'app/components/share/types.ts',
        statementMap: { 0: { start: { line: 3 }, end: { line: 3 } } },
        s: { 0: 1 },
      },
    }

    expect([...loadTrackedCoverageEntries(coverage, context).keys()]).toEqual([
      'web/app/components/share/index.tsx',
    ])
  })

  it('should calculate coverage stats using statement-derived line hits', () => {
    const entry = {
      b: { 0: [1, 0] },
      f: { 0: 1, 1: 0 },
      s: { 0: 1, 1: 0 },
      statementMap: {
        0: { start: { line: 10 }, end: { line: 10 } },
        1: { start: { line: 12 }, end: { line: 13 } },
      },
    }

    expect(getCoverageStats(entry)).toEqual({
      branches: { covered: 1, total: 2 },
      functions: { covered: 1, total: 2 },
      lines: { covered: 1, total: 2 },
      statements: { covered: 1, total: 2 },
    })
  })
})
