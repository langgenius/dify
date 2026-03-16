import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  getChangedBranchCoverage,
  getChangedStatementCoverage,
  getIgnoredChangedLinesFromFile,
  getLineHits,
  normalizeToRepoRelative,
  parseChangedLineMap,
} from './check-components-diff-coverage-lib.mjs'
import {
  collectComponentCoverageExcludedFiles,
  COMPONENT_COVERAGE_EXCLUDE_LABEL,
} from './component-coverage-filters.mjs'
import {
  COMPONENTS_GLOBAL_THRESHOLDS,
  EXCLUDED_COMPONENT_MODULES,
  getComponentModuleThreshold,
} from './components-coverage-thresholds.mjs'

const APP_COMPONENTS_PREFIX = 'web/app/components/'
const APP_COMPONENTS_COVERAGE_PREFIX = 'app/components/'
const SHARED_TEST_PREFIX = 'web/__tests__/'
const STRICT_TEST_FILE_TOUCH = process.env.STRICT_COMPONENT_TEST_TOUCH === 'true'
const EXCLUDED_MODULES_LABEL = [...EXCLUDED_COMPONENT_MODULES].sort().join(', ')

const repoRoot = repoRootFromCwd()
const webRoot = path.join(repoRoot, 'web')
const excludedComponentCoverageFiles = new Set(
  collectComponentCoverageExcludedFiles(path.join(webRoot, 'app/components'), { pathPrefix: 'web/app/components' }),
)
const baseSha = process.env.BASE_SHA?.trim()
const headSha = process.env.HEAD_SHA?.trim() || 'HEAD'
const coverageFinalPath = path.join(webRoot, 'coverage', 'coverage-final.json')

if (!baseSha || /^0+$/.test(baseSha)) {
  appendSummary([
    '### app/components Diff Coverage',
    '',
    'Skipped diff coverage check because `BASE_SHA` was not available.',
  ])
  process.exit(0)
}

if (!fs.existsSync(coverageFinalPath)) {
  console.error(`Coverage report not found at ${coverageFinalPath}`)
  process.exit(1)
}

const coverage = JSON.parse(fs.readFileSync(coverageFinalPath, 'utf8'))
const changedFiles = getChangedFiles(baseSha, headSha)
const changedComponentSourceFiles = changedFiles.filter(isAnyComponentSourceFile)
const changedSourceFiles = changedComponentSourceFiles.filter(isTrackedComponentSourceFile)
const changedExcludedSourceFiles = changedComponentSourceFiles.filter(isExcludedComponentSourceFile)
const changedTestFiles = changedFiles.filter(isRelevantTestFile)

if (changedSourceFiles.length === 0) {
  appendSummary(buildSkipSummary(changedExcludedSourceFiles))
  process.exit(0)
}

const coverageEntries = new Map()
for (const [file, entry] of Object.entries(coverage)) {
  const repoRelativePath = normalizeToRepoRelative(entry.path ?? file, {
    appComponentsCoveragePrefix: APP_COMPONENTS_COVERAGE_PREFIX,
    appComponentsPrefix: APP_COMPONENTS_PREFIX,
    repoRoot,
    sharedTestPrefix: SHARED_TEST_PREFIX,
    webRoot,
  })
  if (!isTrackedComponentSourceFile(repoRelativePath))
    continue

  coverageEntries.set(repoRelativePath, entry)
}

const fileCoverageRows = []
const moduleCoverageMap = new Map()

for (const [file, entry] of coverageEntries.entries()) {
  const stats = getCoverageStats(entry)
  const moduleName = getModuleName(file)
  fileCoverageRows.push({ file, moduleName, ...stats })
  mergeCoverageStats(moduleCoverageMap, moduleName, stats)
}

const overallCoverage = sumCoverageStats(fileCoverageRows)
const diffChanges = getChangedLineMap(baseSha, headSha)
const diffRows = []
const ignoredDiffLines = []
const invalidIgnorePragmas = []

for (const [file, changedLines] of diffChanges.entries()) {
  if (!isTrackedComponentSourceFile(file))
    continue

  const entry = coverageEntries.get(file)
  const ignoreInfo = getIgnoredChangedLinesFromFile(path.join(repoRoot, file), changedLines)
  for (const [line, reason] of ignoreInfo.ignoredLines.entries()) {
    ignoredDiffLines.push({
      file,
      line,
      reason,
    })
  }
  for (const invalidPragma of ignoreInfo.invalidPragmas) {
    invalidIgnorePragmas.push({
      file,
      ...invalidPragma,
    })
  }

  const statements = getChangedStatementCoverage(entry, ignoreInfo.effectiveChangedLines)
  const branches = getChangedBranchCoverage(entry, ignoreInfo.effectiveChangedLines)
  diffRows.push({
    branches,
    file,
    ignoredLineCount: ignoreInfo.ignoredLines.size,
    moduleName: getModuleName(file),
    statements,
  })
}

const diffTotals = diffRows.reduce((acc, row) => {
  acc.statements.total += row.statements.total
  acc.statements.covered += row.statements.covered
  acc.branches.total += row.branches.total
  acc.branches.covered += row.branches.covered
  return acc
}, {
  branches: { total: 0, covered: 0 },
  statements: { total: 0, covered: 0 },
})

const diffStatementFailures = diffRows.filter(row => row.statements.uncoveredLines.length > 0)
const diffBranchFailures = diffRows.filter(row => row.branches.uncoveredBranches.length > 0)
const overallThresholdFailures = getThresholdFailures(overallCoverage, COMPONENTS_GLOBAL_THRESHOLDS)
const moduleCoverageRows = [...moduleCoverageMap.entries()]
  .map(([moduleName, stats]) => ({
    moduleName,
    stats,
    thresholds: getComponentModuleThreshold(moduleName),
  }))
  .map(row => ({
    ...row,
    failures: row.thresholds ? getThresholdFailures(row.stats, row.thresholds) : [],
  }))
const moduleThresholdFailures = moduleCoverageRows
  .filter(row => row.failures.length > 0)
  .flatMap(row => row.failures.map(failure => ({
    moduleName: row.moduleName,
    ...failure,
  })))
const hasRelevantTestChanges = changedTestFiles.length > 0
const missingTestTouch = !hasRelevantTestChanges

appendSummary(buildSummary({
  overallCoverage,
  overallThresholdFailures,
  moduleCoverageRows,
  moduleThresholdFailures,
  diffBranchFailures,
  diffRows,
  diffStatementFailures,
  diffTotals,
  changedSourceFiles,
  changedTestFiles,
  ignoredDiffLines,
  invalidIgnorePragmas,
  missingTestTouch,
}))

if (process.env.CI) {
  for (const failure of diffStatementFailures.slice(0, 20)) {
    const firstLine = failure.statements.uncoveredLines[0] ?? 1
    console.log(`::error file=${failure.file},line=${firstLine}::Uncovered changed statements: ${formatLineRanges(failure.statements.uncoveredLines)}`)
  }
  for (const failure of diffBranchFailures.slice(0, 20)) {
    const firstBranch = failure.branches.uncoveredBranches[0]
    const line = firstBranch?.line ?? 1
    console.log(`::error file=${failure.file},line=${line}::Uncovered changed branches: ${formatBranchRefs(failure.branches.uncoveredBranches)}`)
  }
  for (const invalidPragma of invalidIgnorePragmas.slice(0, 20)) {
    console.log(`::error file=${invalidPragma.file},line=${invalidPragma.line}::Invalid diff coverage ignore pragma: ${invalidPragma.reason}`)
  }
}

if (
  overallThresholdFailures.length > 0
  || moduleThresholdFailures.length > 0
  || diffStatementFailures.length > 0
  || diffBranchFailures.length > 0
  || invalidIgnorePragmas.length > 0
  || (STRICT_TEST_FILE_TOUCH && missingTestTouch)
) {
  process.exit(1)
}

function buildSummary({
  overallCoverage,
  overallThresholdFailures,
  moduleCoverageRows,
  moduleThresholdFailures,
  diffBranchFailures,
  diffRows,
  diffStatementFailures,
  diffTotals,
  changedSourceFiles,
  changedTestFiles,
  ignoredDiffLines,
  invalidIgnorePragmas,
  missingTestTouch,
}) {
  const lines = [
    '### app/components Diff Coverage',
    '',
    `Compared \`${baseSha.slice(0, 12)}\` -> \`${headSha.slice(0, 12)}\``,
    '',
    `Excluded modules: \`${EXCLUDED_MODULES_LABEL}\``,
    `Excluded file kinds: \`${COMPONENT_COVERAGE_EXCLUDE_LABEL}\``,
    '',
    '| Check | Result | Details |',
    '|---|---:|---|',
    `| Overall tracked lines | ${formatPercent(overallCoverage.lines)} | ${overallCoverage.lines.covered}/${overallCoverage.lines.total}; threshold ${COMPONENTS_GLOBAL_THRESHOLDS.lines}% |`,
    `| Overall tracked statements | ${formatPercent(overallCoverage.statements)} | ${overallCoverage.statements.covered}/${overallCoverage.statements.total}; threshold ${COMPONENTS_GLOBAL_THRESHOLDS.statements}% |`,
    `| Overall tracked functions | ${formatPercent(overallCoverage.functions)} | ${overallCoverage.functions.covered}/${overallCoverage.functions.total}; threshold ${COMPONENTS_GLOBAL_THRESHOLDS.functions}% |`,
    `| Overall tracked branches | ${formatPercent(overallCoverage.branches)} | ${overallCoverage.branches.covered}/${overallCoverage.branches.total}; threshold ${COMPONENTS_GLOBAL_THRESHOLDS.branches}% |`,
    `| Changed statements | ${formatDiffPercent(diffTotals.statements)} | ${diffTotals.statements.covered}/${diffTotals.statements.total} |`,
    `| Changed branches | ${formatDiffPercent(diffTotals.branches)} | ${diffTotals.branches.covered}/${diffTotals.branches.total} |`,
    '',
  ]

  if (overallThresholdFailures.length > 0) {
    lines.push('Overall thresholds failed:')
    for (const failure of overallThresholdFailures)
      lines.push(`- ${failure.metric}: ${failure.actual.toFixed(2)}% < ${failure.expected}%`)
    lines.push('')
  }

  if (moduleThresholdFailures.length > 0) {
    lines.push('Module thresholds failed:')
    for (const failure of moduleThresholdFailures)
      lines.push(`- ${failure.moduleName} ${failure.metric}: ${failure.actual.toFixed(2)}% < ${failure.expected}%`)
    lines.push('')
  }

  const moduleRows = moduleCoverageRows
    .map(({ moduleName, stats, thresholds, failures }) => ({
      moduleName,
      lines: percentage(stats.lines.covered, stats.lines.total),
      statements: percentage(stats.statements.covered, stats.statements.total),
      functions: percentage(stats.functions.covered, stats.functions.total),
      branches: percentage(stats.branches.covered, stats.branches.total),
      thresholds,
      failures,
    }))
    .sort((a, b) => {
      if (a.failures.length !== b.failures.length)
        return b.failures.length - a.failures.length

      return a.lines - b.lines || a.moduleName.localeCompare(b.moduleName)
    })

  lines.push('<details><summary>Module coverage</summary>')
  lines.push('')
  lines.push('| Module | Lines | Statements | Functions | Branches | Thresholds | Status |')
  lines.push('|---|---:|---:|---:|---:|---|---|')
  for (const row of moduleRows) {
    const thresholdLabel = row.thresholds
      ? `L${row.thresholds.lines}/S${row.thresholds.statements}/F${row.thresholds.functions}/B${row.thresholds.branches}`
      : 'n/a'
    const status = row.thresholds ? (row.failures.length > 0 ? 'fail' : 'pass') : 'info'
    lines.push(`| ${row.moduleName} | ${row.lines.toFixed(2)}% | ${row.statements.toFixed(2)}% | ${row.functions.toFixed(2)}% | ${row.branches.toFixed(2)}% | ${thresholdLabel} | ${status} |`)
  }
  lines.push('</details>')
  lines.push('')

  const changedRows = diffRows
    .filter(row => row.statements.total > 0 || row.branches.total > 0)
    .sort((a, b) => {
      const aScore = percentage(a.statements.covered + a.branches.covered, a.statements.total + a.branches.total)
      const bScore = percentage(b.statements.covered + b.branches.covered, b.statements.total + b.branches.total)
      return aScore - bScore || a.file.localeCompare(b.file)
    })

  lines.push('<details><summary>Changed file coverage</summary>')
  lines.push('')
  lines.push('| File | Module | Changed statements | Statement coverage | Uncovered statements | Changed branches | Branch coverage | Uncovered branches | Ignored lines |')
  lines.push('|---|---|---:|---:|---|---:|---:|---|---:|')
  for (const row of changedRows) {
    lines.push(`| ${row.file.replace('web/', '')} | ${row.moduleName} | ${row.statements.total} | ${formatDiffPercent(row.statements)} | ${formatLineRanges(row.statements.uncoveredLines)} | ${row.branches.total} | ${formatDiffPercent(row.branches)} | ${formatBranchRefs(row.branches.uncoveredBranches)} | ${row.ignoredLineCount} |`)
  }
  lines.push('</details>')
  lines.push('')

  if (missingTestTouch) {
    lines.push(`Warning: tracked source files changed under \`web/app/components/\`, but no test files changed under \`web/app/components/**\` or \`web/__tests__/\`.`)
    if (STRICT_TEST_FILE_TOUCH)
      lines.push('`STRICT_COMPONENT_TEST_TOUCH=true` is enabled, so this warning fails the check.')
    lines.push('')
  }
  else {
    lines.push(`Relevant test files changed: ${changedTestFiles.length}`)
    lines.push('')
  }

  if (diffStatementFailures.length > 0) {
    lines.push('Uncovered changed statements:')
    for (const row of diffStatementFailures) {
      lines.push(`- ${row.file.replace('web/', '')}: ${formatLineRanges(row.statements.uncoveredLines)}`)
    }
    lines.push('')
  }

  if (diffBranchFailures.length > 0) {
    lines.push('Uncovered changed branches:')
    for (const row of diffBranchFailures) {
      lines.push(`- ${row.file.replace('web/', '')}: ${formatBranchRefs(row.branches.uncoveredBranches)}`)
    }
    lines.push('')
  }

  if (ignoredDiffLines.length > 0) {
    lines.push('Ignored changed lines via pragma:')
    for (const ignoredLine of ignoredDiffLines) {
      lines.push(`- ${ignoredLine.file.replace('web/', '')}:${ignoredLine.line} - ${ignoredLine.reason}`)
    }
    lines.push('')
  }

  if (invalidIgnorePragmas.length > 0) {
    lines.push('Invalid diff coverage ignore pragmas:')
    for (const invalidPragma of invalidIgnorePragmas) {
      lines.push(`- ${invalidPragma.file.replace('web/', '')}:${invalidPragma.line} - ${invalidPragma.reason}`)
    }
    lines.push('')
  }

  lines.push(`Changed source files checked: ${changedSourceFiles.length}`)
  lines.push(`Changed statement coverage: ${percentage(diffTotals.statements.covered, diffTotals.statements.total).toFixed(2)}%`)
  lines.push(`Changed branch coverage: ${percentage(diffTotals.branches.covered, diffTotals.branches.total).toFixed(2)}%`)

  return lines
}

function buildSkipSummary(changedExcludedSourceFiles) {
  const lines = [
    '### app/components Diff Coverage',
    '',
    `Excluded modules: \`${EXCLUDED_MODULES_LABEL}\``,
    `Excluded file kinds: \`${COMPONENT_COVERAGE_EXCLUDE_LABEL}\``,
    '',
  ]

  if (changedExcludedSourceFiles.length > 0) {
    lines.push('Only excluded component modules or type-only files changed, so diff coverage check was skipped.')
    lines.push(`Skipped files: ${changedExcludedSourceFiles.length}`)
  }
  else {
    lines.push('No source changes under tracked `web/app/components/`. Diff coverage check skipped.')
  }

  return lines
}

function getChangedFiles(base, head) {
  const output = execGit(['diff', '--name-only', '--diff-filter=ACMR', `${base}...${head}`, '--', 'web/app/components', 'web/__tests__'])
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function getChangedLineMap(base, head) {
  const diff = execGit(['diff', '--unified=0', '--no-color', '--diff-filter=ACMR', `${base}...${head}`, '--', 'web/app/components'])
  return parseChangedLineMap(diff, isTrackedComponentSourceFile)
}

function isAnyComponentSourceFile(filePath) {
  return filePath.startsWith(APP_COMPONENTS_PREFIX)
    && /\.(?:ts|tsx)$/.test(filePath)
    && !isTestLikePath(filePath)
}

function isTrackedComponentSourceFile(filePath) {
  return isAnyComponentSourceFile(filePath)
    && !isExcludedComponentSourceFile(filePath)
}

function isExcludedComponentSourceFile(filePath) {
  return isAnyComponentSourceFile(filePath)
    && (
      EXCLUDED_COMPONENT_MODULES.has(getModuleName(filePath))
      || excludedComponentCoverageFiles.has(filePath)
    )
}

function isRelevantTestFile(filePath) {
  return filePath.startsWith(SHARED_TEST_PREFIX)
    || (filePath.startsWith(APP_COMPONENTS_PREFIX) && isTestLikePath(filePath) && !isExcludedComponentTestFile(filePath))
}

function isExcludedComponentTestFile(filePath) {
  if (!filePath.startsWith(APP_COMPONENTS_PREFIX))
    return false

  return EXCLUDED_COMPONENT_MODULES.has(getModuleName(filePath))
}

function isTestLikePath(filePath) {
  return /(?:^|\/)__tests__\//.test(filePath)
    || /(?:^|\/)__mocks__\//.test(filePath)
    || /\.(?:spec|test)\.(?:ts|tsx)$/.test(filePath)
    || /\.stories\.(?:ts|tsx)$/.test(filePath)
    || /\.d\.ts$/.test(filePath)
}

function getCoverageStats(entry) {
  const lineHits = getLineHits(entry)
  const statementHits = Object.values(entry.s ?? {})
  const functionHits = Object.values(entry.f ?? {})
  const branchHits = Object.values(entry.b ?? {}).flat()

  return {
    lines: {
      covered: Object.values(lineHits).filter(count => count > 0).length,
      total: Object.keys(lineHits).length,
    },
    statements: {
      covered: statementHits.filter(count => count > 0).length,
      total: statementHits.length,
    },
    functions: {
      covered: functionHits.filter(count => count > 0).length,
      total: functionHits.length,
    },
    branches: {
      covered: branchHits.filter(count => count > 0).length,
      total: branchHits.length,
    },
  }
}

function sumCoverageStats(rows) {
  const total = createEmptyCoverageStats()
  for (const row of rows)
    addCoverageStats(total, row)
  return total
}

function mergeCoverageStats(map, moduleName, stats) {
  const existing = map.get(moduleName) ?? createEmptyCoverageStats()
  addCoverageStats(existing, stats)
  map.set(moduleName, existing)
}

function addCoverageStats(target, source) {
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    target[metric].covered += source[metric].covered
    target[metric].total += source[metric].total
  }
}

function createEmptyCoverageStats() {
  return {
    lines: { covered: 0, total: 0 },
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
  }
}

function getThresholdFailures(stats, thresholds) {
  const failures = []
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    const actual = percentage(stats[metric].covered, stats[metric].total)
    const expected = thresholds[metric]
    if (actual < expected) {
      failures.push({
        metric,
        actual,
        expected,
      })
    }
  }
  return failures
}

function getModuleName(filePath) {
  const relativePath = filePath.slice(APP_COMPONENTS_PREFIX.length)
  if (!relativePath)
    return '(root)'

  const segments = relativePath.split('/')
  return segments.length === 1 ? '(root)' : segments[0]
}

function formatLineRanges(lines) {
  if (!lines || lines.length === 0)
    return ''

  const ranges = []
  let start = lines[0]
  let end = lines[0]

  for (let index = 1; index < lines.length; index += 1) {
    const current = lines[index]
    if (current === end + 1) {
      end = current
      continue
    }

    ranges.push(start === end ? `${start}` : `${start}-${end}`)
    start = current
    end = current
  }

  ranges.push(start === end ? `${start}` : `${start}-${end}`)
  return ranges.join(', ')
}

function formatBranchRefs(branches) {
  if (!branches || branches.length === 0)
    return ''

  return branches.map(branch => `${branch.line}[${branch.armIndex}]`).join(', ')
}

function percentage(covered, total) {
  if (total === 0)
    return 100
  return (covered / total) * 100
}

function formatPercent(metric) {
  return `${percentage(metric.covered, metric.total).toFixed(2)}%`
}

function formatDiffPercent(metric) {
  if (metric.total === 0)
    return 'n/a'

  return `${percentage(metric.covered, metric.total).toFixed(2)}%`
}

function appendSummary(lines) {
  const content = `${lines.join('\n')}\n`
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, content)
  console.log(content)
}

function execGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  })
}

function repoRootFromCwd() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim()
}
