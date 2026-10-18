// Usage: node report.cjs rank AUDIT.json COUNT OUTPUT.json [REVIEWED.json]
//        node report.cjs compare BEFORE.json AFTER.json OUTPUT.json [FILES.txt]
const fs = require('node:fs')

// Specific candidates outrank setup volume. Neither score confirms violations.
const actionWeights = {
  unsafe_assertion_chains: 3,
  class_assertions: 3,
  render_existence_assertion_candidate: 3,
  afterEach_mock_reset_candidate: 2,
  bare_async_call_candidate: 3,
  fixed_wait_candidate: 3,
  ts_ignore: 3,
  ts_nocheck: 3,
}
const contextWeights = {
  module_mock: 1,
  vi_fn: 1,
  vi_spyOn: 1,
  testid_queries: 1,
  css_dom_queries: 1,
  promise_timer_candidate: 1,
}
const contextMetricCap = 10
function read(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (report.metricSchema !== 'frontend-test-maintenance-v3' || !Array.isArray(report.policies))
    throw new Error(`Unsupported audit schema in ${file}; regenerate both snapshots with audit.cjs`)
  return report
}
function totals(report, files) {
  const counts = {}
  for (const item of report.findings) {
    if (!files || files.has(item.file)) counts[item.metric] = (counts[item.metric] || 0) + 1
  }
  return counts
}
function delta(before, after, files) {
  const a = totals(before, files)
  const b = totals(after, files)
  return Object.fromEntries(
    [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().map((metric) => [
      metric,
      {
        before: a[metric] || 0,
        after: b[metric] || 0,
        delta: (b[metric] || 0) - (a[metric] || 0),
      },
    ]),
  )
}
const [mode, ...args] = process.argv.slice(2)
if (mode === '--help') {
  console.log(
    'Usage: node report.cjs rank AUDIT.json COUNT OUTPUT.json [REVIEWED.json]\n       node report.cjs compare BEFORE.json AFTER.json OUTPUT.json [FILES.txt]',
  )
} else if (mode === 'rank') {
  const [input, countText, output, reviewedPath] = args
  const count = Number(countText)
  if (!input || !output || !Number.isInteger(count) || count < 1)
    throw new Error('rank requires AUDIT.json, positive COUNT and OUTPUT.json')
  const report = read(input)
  const reviews = new Map()
  let reviewHistoryApplicable = false
  if (reviewedPath) {
    const history = JSON.parse(fs.readFileSync(reviewedPath, 'utf8'))
    if (!Array.isArray(history.files) || !Array.isArray(history.policies) || !history.scannerSha256)
      throw new Error(
        'Review history requires files, policies and scannerSha256; a ranked list is not a review record',
      )
    for (const entry of history.files) {
      if (
        !entry.file ||
        !entry.sha256 ||
        !['retain', 'cleaned'].includes(entry.decision) ||
        !entry.reason?.trim()
      )
        throw new Error(
          'Each reviewed file requires file, sha256, retain/cleaned decision and a reason',
        )
      reviews.set(entry.file, entry)
    }
    reviewHistoryApplicable =
      history.scannerSha256 === report.scannerSha256 &&
      JSON.stringify(history.policies) === JSON.stringify(report.policies)
  }
  const perFile = new Map(
    report.inventory.map((file) => [
      file.file,
      { ...file, actionScore: 0, contextScore: 0, metrics: {} },
    ]),
  )
  for (const finding of report.findings) {
    const row = perFile.get(finding.file)
    row.metrics[finding.metric] = (row.metrics[finding.metric] || 0) + 1
    row.actionScore += actionWeights[finding.metric] || 0
  }
  const deferredReviewed = []
  const staleReviewFiles = []
  for (const row of perFile.values()) {
    row.contextScore = Object.entries(contextWeights).reduce(
      (sum, [metric, weight]) =>
        sum + Math.min(row.metrics[metric] || 0, contextMetricCap) * weight,
      0,
    )
    row.priority = row.actionScore ? 'action-candidate' : 'context-only'
    const review = reviews.get(row.file)
    if (review && reviewHistoryApplicable && review.sha256 === row.sha256) {
      deferredReviewed.push({ ...row, decision: review.decision, reason: review.reason })
      perFile.delete(row.file)
    } else if (review) staleReviewFiles.push(row.file)
  }
  const candidates = [...perFile.values()]
    .sort(
      (a, b) =>
        b.actionScore - a.actionScore ||
        b.contextScore - a.contextScore ||
        a.file.localeCompare(b.file),
    )
    .slice(0, count)
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        purpose:
          'Static review queue, not confirmed violations or a deletion list. Review contracts before recommending edits.',
        commit: report.commit,
        requestedScopes: report.requestedScopes,
        policies: report.policies,
        scannerSha256: report.scannerSha256,
        ranking: {
          actionWeights,
          contextWeights,
          contextMetricCap,
          order: ['actionScore descending', 'contextScore descending', 'file path'],
        },
        reviewHistoryApplicable,
        staleReviewFiles,
        deferredReviewed,
        candidates,
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(`${output}.files.txt`, `${candidates.map((row) => row.file).join('\n')}\n`)
  console.log(
    JSON.stringify({ output, manifest: `${output}.files.txt`, candidates: candidates.length }),
  )
} else if (mode === 'compare') {
  const [beforePath, afterPath, output, manifest] = args
  if (!beforePath || !afterPath || !output)
    throw new Error('compare requires BEFORE.json, AFTER.json and OUTPUT.json')
  const before = read(beforePath)
  const after = read(afterPath)
  if (
    JSON.stringify(before.requestedScopes) !== JSON.stringify(after.requestedScopes) ||
    before.scannerSha256 !== after.scannerSha256 ||
    JSON.stringify(before.policies) !== JSON.stringify(after.policies)
  )
    throw new Error(
      'Scope, scanner or policy changed; regenerate comparable snapshots before claiming reductions',
    )
  const oldFiles = new Map(before.inventory.map((file) => [file.file, file]))
  const newFiles = new Map(after.inventory.map((file) => [file.file, file]))
  const selected = new Set(
    manifest
      ? fs
          .readFileSync(manifest, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : oldFiles.keys(),
  )
  if (!selected.size) throw new Error('Empty comparison manifest')
  for (const file of selected)
    if (!oldFiles.has(file)) throw new Error(`File missing from baseline: ${file}`)
  const added = [...newFiles.keys()].filter((file) => !oldFiles.has(file))
  const removed = [...oldFiles.keys()].filter((file) => !newFiles.has(file))
  const changed = [...newFiles.keys()].filter(
    (file) => oldFiles.has(file) && oldFiles.get(file).sha256 !== newFiles.get(file).sha256,
  )
  const outsideSelection = new Set(
    [...added, ...removed, ...changed].filter((file) => !selected.has(file)),
  )
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        beforeCommit: before.commit,
        afterCommit: after.commit,
        requestedScopes: before.requestedScopes,
        policies: before.policies,
        selectedFiles: [...selected],
        selectedMetrics: delta(before, after, selected),
        wholeScopeMetrics: delta(before, after),
        added,
        removed,
        changed,
        changedOutsideSelection: [...outsideSelection],
        outsideSelectionMetrics: delta(before, after, outsideSelection),
        perFile: [...selected].map((file) => ({
          file,
          status: !newFiles.has(file)
            ? 'removed'
            : changed.includes(file)
              ? 'changed'
              : 'unchanged',
          metrics: delta(before, after, new Set([file])),
        })),
        caveat:
          'Renames appear as removal plus addition. Counts alone do not prove behavior preservation or elimination of debt moved into other helpers.',
      },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify({
      output,
      selected: selected.size,
      changed: changed.length,
      added: added.length,
      removed: removed.length,
      changedOutsideSelection: outsideSelection.size,
    }),
  )
} else {
  throw new Error('Expected rank or compare; see --help')
}
