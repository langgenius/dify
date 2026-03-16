import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import {
  buildGitDiffRevisionArgs,
} from './check-components-diff-coverage-lib.mjs'
import {
  createComponentCoverageContext,
  isAnyWebTestFile,
  isRelevantTestFile,
  isTrackedComponentSourceFile,
} from './components-coverage-common.mjs'

const DIFF_RANGE_MODE = process.env.DIFF_RANGE_MODE === 'exact' ? 'exact' : 'merge-base'

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

const changedFiles = getChangedFiles(baseSha, headSha)
const changedSourceFiles = changedFiles.filter(filePath => isTrackedComponentSourceFile(filePath, context.excludedComponentCoverageFiles))

if (changedSourceFiles.length === 0) {
  appendSummary([
    '### app/components Test Touch',
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
  changedSourceFiles,
  totalChangedWebTests,
}))

function buildSummary({
  changedOtherWebTestFiles,
  changedRelevantTestFiles,
  changedSourceFiles,
  totalChangedWebTests,
}) {
  const lines = [
    '### app/components Test Touch',
    '',
    `Compared \`${baseSha.slice(0, 12)}\` -> \`${headSha.slice(0, 12)}\``,
    `Diff range mode: \`${DIFF_RANGE_MODE}\``,
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

function getChangedFiles(base, head) {
  const output = execGit(['diff', '--name-only', '--diff-filter=ACMR', ...buildGitDiffRevisionArgs(base, head, DIFF_RANGE_MODE), '--', 'web'])
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
