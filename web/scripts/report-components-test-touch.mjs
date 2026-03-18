import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import {
  buildGitDiffRevisionArgs,
  normalizeDiffRangeMode,
  resolveGitDiffContext,
} from './check-components-diff-coverage-lib.mjs'
import {
  createComponentCoverageContext,
  isAnyWebTestFile,
  isRelevantTestFile,
  isTrackedComponentSourceFile,
} from './components-coverage-common.mjs'

const REQUESTED_DIFF_RANGE_MODE = normalizeDiffRangeMode(process.env.DIFF_RANGE_MODE)

const repoRoot = repoRootFromCwd()
const context = createComponentCoverageContext(repoRoot)
const baseSha = process.env.BASE_SHA?.trim()
const headSha = process.env.HEAD_SHA?.trim() || 'HEAD'

if (!baseSha || /^0+$/.test(baseSha)) {
  appendSummary([
    '### app/components Test Touch',
    '',
    'Skipped test-touch report because `BASE_SHA` was not available.',
  ])
  process.exit(0)
}

const diffContext = resolveGitDiffContext({
  base: baseSha,
  head: headSha,
  mode: REQUESTED_DIFF_RANGE_MODE,
  execGit,
})
const changedFiles = getChangedFiles(diffContext)
const changedSourceFiles = changedFiles.filter(filePath => isTrackedComponentSourceFile(filePath, context.excludedComponentCoverageFiles))

if (changedSourceFiles.length === 0) {
  appendSummary([
    '### app/components Test Touch',
    '',
    ...buildDiffContextSummary(diffContext),
    '',
    'No tracked source changes under `web/app/components/`. Test-touch report skipped.',
  ])
  process.exit(0)
}

const changedRelevantTestFiles = changedFiles.filter(isRelevantTestFile)
const changedOtherWebTestFiles = changedFiles.filter(filePath => isAnyWebTestFile(filePath) && !isRelevantTestFile(filePath))
const totalChangedWebTests = [...new Set([...changedRelevantTestFiles, ...changedOtherWebTestFiles])]

appendSummary(buildSummary({
  changedOtherWebTestFiles,
  changedRelevantTestFiles,
  diffContext,
  changedSourceFiles,
  totalChangedWebTests,
}))

function buildSummary({
  changedOtherWebTestFiles,
  changedRelevantTestFiles,
  diffContext,
  changedSourceFiles,
  totalChangedWebTests,
}) {
  const lines = [
    '### app/components Test Touch',
    '',
    ...buildDiffContextSummary(diffContext),
    '',
    `Tracked source files changed: ${changedSourceFiles.length}`,
    `Component-local or shared integration tests changed: ${changedRelevantTestFiles.length}`,
    `Other web tests changed: ${changedOtherWebTestFiles.length}`,
    `Total changed web tests: ${totalChangedWebTests.length}`,
    '',
  ]

  if (totalChangedWebTests.length === 0) {
    lines.push('Warning: no frontend test files changed alongside tracked component source changes.')
    lines.push('')
  }

  if (changedRelevantTestFiles.length > 0) {
    lines.push('<details><summary>Changed component-local or shared tests</summary>')
    lines.push('')
    for (const filePath of changedRelevantTestFiles.slice(0, 40))
      lines.push(`- ${filePath.replace('web/', '')}`)
    if (changedRelevantTestFiles.length > 40)
      lines.push(`- ... ${changedRelevantTestFiles.length - 40} more`)
    lines.push('</details>')
    lines.push('')
  }

  if (changedOtherWebTestFiles.length > 0) {
    lines.push('<details><summary>Changed other web tests</summary>')
    lines.push('')
    for (const filePath of changedOtherWebTestFiles.slice(0, 40))
      lines.push(`- ${filePath.replace('web/', '')}`)
    if (changedOtherWebTestFiles.length > 40)
      lines.push(`- ... ${changedOtherWebTestFiles.length - 40} more`)
    lines.push('</details>')
    lines.push('')
  }

  lines.push('Report only: test-touch is now advisory and no longer blocks the diff coverage gate.')
  return lines
}

function buildDiffContextSummary(diffContext) {
  const lines = [
    `Compared \`${diffContext.base.slice(0, 12)}\` -> \`${diffContext.head.slice(0, 12)}\``,
  ]

  if (diffContext.useCombinedMergeDiff) {
    lines.push(`Requested diff range mode: \`${diffContext.requestedMode}\``)
    lines.push(`Effective diff strategy: \`combined-merge\` (${diffContext.reason})`)
  }
  else if (diffContext.reason) {
    lines.push(`Requested diff range mode: \`${diffContext.requestedMode}\``)
    lines.push(`Effective diff range mode: \`${diffContext.mode}\` (${diffContext.reason})`)
  }
  else {
    lines.push(`Diff range mode: \`${diffContext.mode}\``)
  }

  return lines
}

function getChangedFiles(diffContext) {
  if (diffContext.useCombinedMergeDiff) {
    const output = execGit(['diff-tree', '--cc', '--no-commit-id', '--name-only', '-r', diffContext.head, '--', 'web'])
    return output
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  }

  const output = execGit(['diff', '--name-only', '--diff-filter=ACMR', ...buildGitDiffRevisionArgs(diffContext.base, diffContext.head, diffContext.mode), '--', 'web'])
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
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
