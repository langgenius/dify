import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  buildGitDiffRevisionArgs,
  getChangedBranchCoverage,
  getChangedStatementCoverage,
  getIgnoredChangedLinesFromFile,
  parseChangedLineMap,
} from './check-components-diff-coverage-lib.mjs'
import { COMPONENT_COVERAGE_EXCLUDE_LABEL } from './component-coverage-filters.mjs'
import {
  APP_COMPONENTS_PREFIX,
  createComponentCoverageContext,
  getModuleName,
  isAnyComponentSourceFile,
  isExcludedComponentSourceFile,
  isTrackedComponentSourceFile,
  loadTrackedCoverageEntries,
} from './components-coverage-common.mjs'
import { EXCLUDED_COMPONENT_MODULES } from './components-coverage-thresholds.mjs'

const DIFF_RANGE_MODE = process.env.DIFF_RANGE_MODE === 'exact' ? 'exact' : 'merge-base'
const EXCLUDED_MODULES_LABEL = [...EXCLUDED_COMPONENT_MODULES].sort().join(', ')

const repoRoot = repoRootFromCwd()
const context = createComponentCoverageContext(repoRoot)
const baseSha = process.env.BASE_SHA?.trim()
const headSha = process.env.HEAD_SHA?.trim() || 'HEAD'
const coverageFinalPath = path.join(context.webRoot, 'coverage', 'coverage-final.json')

if (!baseSha || /^0+$/.test(baseSha)) {
  appendSummary([
    '### app/components Pure Diff Coverage',
    '',
    'Skipped pure diff coverage check because `BASE_SHA` was not available.',
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
const changedSourceFiles = changedComponentSourceFiles.filter(filePath => isTrackedComponentSourceFile(filePath, context.excludedComponentCoverageFiles))
const changedExcludedSourceFiles = changedComponentSourceFiles.filter(filePath => isExcludedComponentSourceFile(filePath, context.excludedComponentCoverageFiles))

if (changedSourceFiles.length === 0) {
  appendSummary(buildSkipSummary(changedExcludedSourceFiles))
  process.exit(0)
}

const coverageEntries = loadTrackedCoverageEntries(coverage, context)
const diffChanges = getChangedLineMap(baseSha, headSha)
const diffRows = []
const ignoredDiffLines = []
const invalidIgnorePragmas = []

for (const [file, changedLines] of diffChanges.entries()) {
  if (!isTrackedComponentSourceFile(file, context.excludedComponentCoverageFiles))
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

appendSummary(buildSummary({
  changedSourceFiles,
  diffBranchFailures,
  diffRows,
  diffStatementFailures,
  diffTotals,
  ignoredDiffLines,
  invalidIgnorePragmas,
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
  diffStatementFailures.length > 0
  || diffBranchFailures.length > 0
  || invalidIgnorePragmas.length > 0
) {
  process.exit(1)
}

function buildSummary({
  changedSourceFiles,
  diffBranchFailures,
  diffRows,
  diffStatementFailures,
  diffTotals,
  ignoredDiffLines,
  invalidIgnorePragmas,
}) {
  const lines = [
    '### app/components Pure Diff Coverage',
    '',
    `Compared \`${baseSha.slice(0, 12)}\` -> \`${headSha.slice(0, 12)}\``,
    `Diff range mode: \`${DIFF_RANGE_MODE}\``,
    '',
    `Excluded modules: \`${EXCLUDED_MODULES_LABEL}\``,
    `Excluded file kinds: \`${COMPONENT_COVERAGE_EXCLUDE_LABEL}\``,
    '',
    '| Check | Result | Details |',
    '|---|---:|---|',
    `| Changed statements | ${formatDiffPercent(diffTotals.statements)} | ${diffTotals.statements.covered}/${diffTotals.statements.total} |`,
    `| Changed branches | ${formatDiffPercent(diffTotals.branches)} | ${diffTotals.branches.covered}/${diffTotals.branches.total} |`,
    '',
  ]

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

  if (diffStatementFailures.length > 0) {
    lines.push('Uncovered changed statements:')
    for (const row of diffStatementFailures)
      lines.push(`- ${row.file.replace('web/', '')}: ${formatLineRanges(row.statements.uncoveredLines)}`)
    lines.push('')
  }

  if (diffBranchFailures.length > 0) {
    lines.push('Uncovered changed branches:')
    for (const row of diffBranchFailures)
      lines.push(`- ${row.file.replace('web/', '')}: ${formatBranchRefs(row.branches.uncoveredBranches)}`)
    lines.push('')
  }

  if (ignoredDiffLines.length > 0) {
    lines.push('Ignored changed lines via pragma:')
    for (const ignoredLine of ignoredDiffLines)
      lines.push(`- ${ignoredLine.file.replace('web/', '')}:${ignoredLine.line} - ${ignoredLine.reason}`)
    lines.push('')
  }

  if (invalidIgnorePragmas.length > 0) {
    lines.push('Invalid diff coverage ignore pragmas:')
    for (const invalidPragma of invalidIgnorePragmas)
      lines.push(`- ${invalidPragma.file.replace('web/', '')}:${invalidPragma.line} - ${invalidPragma.reason}`)
    lines.push('')
  }

  lines.push(`Changed source files checked: ${changedSourceFiles.length}`)
  lines.push('Blocking rules: uncovered changed statements, uncovered changed branches, invalid ignore pragmas.')

  return lines
}

function buildSkipSummary(changedExcludedSourceFiles) {
  const lines = [
    '### app/components Pure Diff Coverage',
    '',
    `Excluded modules: \`${EXCLUDED_MODULES_LABEL}\``,
    `Excluded file kinds: \`${COMPONENT_COVERAGE_EXCLUDE_LABEL}\``,
    '',
  ]

  if (changedExcludedSourceFiles.length > 0) {
    lines.push('Only excluded component modules or type-only files changed, so pure diff coverage was skipped.')
    lines.push(`Skipped files: ${changedExcludedSourceFiles.length}`)
  }
  else {
    lines.push('No tracked source changes under `web/app/components/`. Pure diff coverage skipped.')
  }

  return lines
}

function getChangedFiles(base, head) {
  const output = execGit(['diff', '--name-only', '--diff-filter=ACMR', ...buildGitDiffRevisionArgs(base, head, DIFF_RANGE_MODE), '--', APP_COMPONENTS_PREFIX])
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

function getChangedLineMap(base, head) {
  const diff = execGit(['diff', '--unified=0', '--no-color', '--diff-filter=ACMR', ...buildGitDiffRevisionArgs(base, head, DIFF_RANGE_MODE), '--', APP_COMPONENTS_PREFIX])
  return parseChangedLineMap(diff, filePath => isTrackedComponentSourceFile(filePath, context.excludedComponentCoverageFiles))
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
