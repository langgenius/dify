import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { COMPONENT_COVERAGE_EXCLUDE_LABEL } from './component-coverage-filters.mjs'
import {
  collectTrackedComponentSourceFiles,
  createComponentCoverageContext,
  formatPercent,
  getCoverageStats,
  getModuleName,
  loadTrackedCoverageEntries,
  mergeCoverageStats,
  percentage,
  sumCoverageStats,
} from './components-coverage-common.mjs'
import {
  COMPONENTS_GLOBAL_THRESHOLDS,
  EXCLUDED_COMPONENT_MODULES,
  getComponentModuleThreshold,
} from './components-coverage-thresholds.mjs'

const EXCLUDED_MODULES_LABEL = [...EXCLUDED_COMPONENT_MODULES].sort().join(', ')

const repoRoot = repoRootFromCwd()
const context = createComponentCoverageContext(repoRoot)
const coverageFinalPath = path.join(context.webRoot, 'coverage', 'coverage-final.json')

if (!fs.existsSync(coverageFinalPath)) {
  console.error(`Coverage report not found at ${coverageFinalPath}`)
  process.exit(1)
}

const coverage = JSON.parse(fs.readFileSync(coverageFinalPath, 'utf8'))
const trackedSourceFiles = collectTrackedComponentSourceFiles(context)
const coverageEntries = loadTrackedCoverageEntries(coverage, context)
const fileCoverageRows = []
const moduleCoverageMap = new Map()

for (const [file, entry] of coverageEntries.entries()) {
  const stats = getCoverageStats(entry)
  const moduleName = getModuleName(file)
  fileCoverageRows.push({ file, moduleName, ...stats })
  mergeCoverageStats(moduleCoverageMap, moduleName, stats)
}

const overallCoverage = sumCoverageStats(fileCoverageRows)
const overallTargetGaps = getTargetGaps(overallCoverage, COMPONENTS_GLOBAL_THRESHOLDS)
const moduleCoverageRows = [...moduleCoverageMap.entries()]
  .map(([moduleName, stats]) => ({
    moduleName,
    stats,
    targets: getComponentModuleThreshold(moduleName),
  }))
  .map(row => ({
    ...row,
    targetGaps: row.targets ? getTargetGaps(row.stats, row.targets) : [],
  }))
  .sort((a, b) => {
    const aWorst = Math.min(...a.targetGaps.map(gap => gap.delta), Number.POSITIVE_INFINITY)
    const bWorst = Math.min(...b.targetGaps.map(gap => gap.delta), Number.POSITIVE_INFINITY)
    return aWorst - bWorst || a.moduleName.localeCompare(b.moduleName)
  })

appendSummary(buildSummary({
  coverageEntriesCount: coverageEntries.size,
  moduleCoverageRows,
  overallCoverage,
  overallTargetGaps,
  trackedSourceFilesCount: trackedSourceFiles.length,
}))

function buildSummary({
  coverageEntriesCount,
  moduleCoverageRows,
  overallCoverage,
  overallTargetGaps,
  trackedSourceFilesCount,
}) {
  const lines = [
    '### app/components Baseline Coverage',
    '',
    `Excluded modules: \`${EXCLUDED_MODULES_LABEL}\``,
    `Excluded file kinds: \`${COMPONENT_COVERAGE_EXCLUDE_LABEL}\``,
    '',
    `Coverage entries: ${coverageEntriesCount}/${trackedSourceFilesCount} tracked source files`,
    '',
    '| Metric | Current | Target | Delta |',
    '|---|---:|---:|---:|',
    `| Lines | ${formatPercent(overallCoverage.lines)} | ${COMPONENTS_GLOBAL_THRESHOLDS.lines}% | ${formatDelta(overallCoverage.lines, COMPONENTS_GLOBAL_THRESHOLDS.lines)} |`,
    `| Statements | ${formatPercent(overallCoverage.statements)} | ${COMPONENTS_GLOBAL_THRESHOLDS.statements}% | ${formatDelta(overallCoverage.statements, COMPONENTS_GLOBAL_THRESHOLDS.statements)} |`,
    `| Functions | ${formatPercent(overallCoverage.functions)} | ${COMPONENTS_GLOBAL_THRESHOLDS.functions}% | ${formatDelta(overallCoverage.functions, COMPONENTS_GLOBAL_THRESHOLDS.functions)} |`,
    `| Branches | ${formatPercent(overallCoverage.branches)} | ${COMPONENTS_GLOBAL_THRESHOLDS.branches}% | ${formatDelta(overallCoverage.branches, COMPONENTS_GLOBAL_THRESHOLDS.branches)} |`,
    '',
  ]

  if (coverageEntriesCount !== trackedSourceFilesCount) {
    lines.push('Warning: coverage report did not include every tracked component source file. CI should set `VITEST_COVERAGE_SCOPE=app-components` before collecting coverage.')
    lines.push('')
  }

  if (overallTargetGaps.length > 0) {
    lines.push('Below baseline targets:')
    for (const gap of overallTargetGaps)
      lines.push(`- overall ${gap.metric}: ${gap.actual.toFixed(2)}% < ${gap.target}%`)
    lines.push('')
  }

  lines.push('<details><summary>Module baseline coverage</summary>')
  lines.push('')
  lines.push('| Module | Lines | Statements | Functions | Branches | Targets | Status |')
  lines.push('|---|---:|---:|---:|---:|---|---|')
  for (const row of moduleCoverageRows) {
    const targetsLabel = row.targets
      ? `L${row.targets.lines}/S${row.targets.statements}/F${row.targets.functions}/B${row.targets.branches}`
      : 'n/a'
    const status = row.targets
      ? (row.targetGaps.length > 0 ? 'below-target' : 'at-target')
      : 'unconfigured'
    lines.push(`| ${row.moduleName} | ${percentage(row.stats.lines.covered, row.stats.lines.total).toFixed(2)}% | ${percentage(row.stats.statements.covered, row.stats.statements.total).toFixed(2)}% | ${percentage(row.stats.functions.covered, row.stats.functions.total).toFixed(2)}% | ${percentage(row.stats.branches.covered, row.stats.branches.total).toFixed(2)}% | ${targetsLabel} | ${status} |`)
  }
  lines.push('</details>')
  lines.push('')
  lines.push('Report only: baseline targets no longer gate CI. The blocking rule is the pure diff coverage step.')

  return lines
}

function getTargetGaps(stats, targets) {
  const gaps = []
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    const actual = percentage(stats[metric].covered, stats[metric].total)
    const target = targets[metric]
    const delta = actual - target
    if (delta < 0) {
      gaps.push({
        actual,
        delta,
        metric,
        target,
      })
    }
  }
  return gaps
}

function formatDelta(metric, target) {
  const actual = percentage(metric.covered, metric.total)
  const delta = actual - target
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(2)}%`
}

function appendSummary(lines) {
  const content = `${lines.join('\n')}\n`
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, content)
  console.log(content)
}

function repoRootFromCwd() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim()
}
