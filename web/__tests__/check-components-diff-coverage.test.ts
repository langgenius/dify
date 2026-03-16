import {
  getChangedBranchCoverage,
  getChangedStatementCoverage,
  getIgnoredChangedLinesFromSource,
  normalizeToRepoRelative,
  parseChangedLineMap,
} from '../scripts/check-components-diff-coverage-lib.mjs'

describe('check-components-diff-coverage helpers', () => {
  it('should parse changed line maps from unified diffs', () => {
    const diff = [
      'diff --git a/web/app/components/share/a.ts b/web/app/components/share/a.ts',
      '+++ b/web/app/components/share/a.ts',
      '@@ -10,0 +11,2 @@',
      '+const a = 1',
      '+const b = 2',
      'diff --git a/web/app/components/base/b.ts b/web/app/components/base/b.ts',
      '+++ b/web/app/components/base/b.ts',
      '@@ -20 +21 @@',
      '+const c = 3',
      'diff --git a/web/README.md b/web/README.md',
      '+++ b/web/README.md',
      '@@ -1 +1 @@',
      '+ignore me',
    ].join('\n')

    const lineMap = parseChangedLineMap(diff, (filePath: string) => filePath.startsWith('web/app/components/'))

    expect([...lineMap.entries()]).toEqual([
      ['web/app/components/share/a.ts', new Set([11, 12])],
      ['web/app/components/base/b.ts', new Set([21])],
    ])
  })

  it('should normalize coverage and absolute paths to repo-relative paths', () => {
    const repoRoot = '/repo'
    const webRoot = '/repo/web'

    expect(normalizeToRepoRelative('web/app/components/share/a.ts', {
      appComponentsCoveragePrefix: 'app/components/',
      appComponentsPrefix: 'web/app/components/',
      repoRoot,
      sharedTestPrefix: 'web/__tests__/',
      webRoot,
    })).toBe('web/app/components/share/a.ts')

    expect(normalizeToRepoRelative('app/components/share/a.ts', {
      appComponentsCoveragePrefix: 'app/components/',
      appComponentsPrefix: 'web/app/components/',
      repoRoot,
      sharedTestPrefix: 'web/__tests__/',
      webRoot,
    })).toBe('web/app/components/share/a.ts')

    expect(normalizeToRepoRelative('/repo/web/app/components/share/a.ts', {
      appComponentsCoveragePrefix: 'app/components/',
      appComponentsPrefix: 'web/app/components/',
      repoRoot,
      sharedTestPrefix: 'web/__tests__/',
      webRoot,
    })).toBe('web/app/components/share/a.ts')
  })

  it('should calculate changed statement coverage from changed lines', () => {
    const entry = {
      s: { 0: 1, 1: 0 },
      statementMap: {
        0: { start: { line: 10 }, end: { line: 10 } },
        1: { start: { line: 12 }, end: { line: 13 } },
      },
    }

    const coverage = getChangedStatementCoverage(entry, new Set([10, 12]))

    expect(coverage).toEqual({
      covered: 1,
      total: 2,
      uncoveredLines: [12],
    })
  })

  it('should fail changed lines when a source file has no coverage entry', () => {
    const coverage = getChangedStatementCoverage(undefined, new Set([42, 43]))

    expect(coverage).toEqual({
      covered: 0,
      total: 2,
      uncoveredLines: [42, 43],
    })
  })

  it('should calculate changed branch coverage using changed branch definitions', () => {
    const entry = {
      b: {
        0: [1, 0],
      },
      branchMap: {
        0: {
          line: 20,
          loc: { start: { line: 20 }, end: { line: 20 } },
          locations: [
            { start: { line: 20 }, end: { line: 20 } },
            { start: { line: 21 }, end: { line: 21 } },
          ],
          type: 'if',
        },
      },
    }

    const coverage = getChangedBranchCoverage(entry, new Set([20]))

    expect(coverage).toEqual({
      covered: 1,
      total: 2,
      uncoveredBranches: [
        { armIndex: 1, line: 21 },
      ],
    })
  })

  it('should ignore changed lines with valid pragma reasons and report invalid pragmas', () => {
    const sourceCode = [
      'const a = 1',
      'const b = 2 // diff-coverage-ignore-line: defensive fallback',
      'const c = 3 // diff-coverage-ignore-line:',
      'const d = 4 // diff-coverage-ignore-line: not changed',
    ].join('\n')

    const result = getIgnoredChangedLinesFromSource(sourceCode, new Set([2, 3]))

    expect([...result.effectiveChangedLines]).toEqual([3])
    expect([...result.ignoredLines.entries()]).toEqual([
      [2, 'defensive fallback'],
    ])
    expect(result.invalidPragmas).toEqual([
      { line: 3, reason: 'missing ignore reason' },
    ])
  })
})
