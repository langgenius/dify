// Usage: node report.cjs rank AUDIT.json COUNT OUTPUT.json [REVIEWED.json] [--focus quality|typing|all]
//        node report.cjs compare BEFORE.json AFTER.json OUTPUT.json [FILES.txt]
const fs = require('node:fs')

const path = require('node:path')
const crypto = require('node:crypto')

// Independent review dimensions. Scores select evidence to inspect, not violations.
const queueWeights = {
  'mock-boundary': {
    mock_internal_hook_or_store_candidate: 3,
    local_mock_jsx_factory_candidate: 4,
    mock_dify_ui: 4,
    mock_nuqs: 2,
  },
  'behavior-value': {
    callback_only_test_candidate: 3,
    render_existence_assertion_candidate: 4,
    class_assertions: 3,
    snapshots: 1,
  },
  typing: {
    unsafe_assertion_chains: 3,
    afterEach_mock_reset_candidate: 2,
    bare_async_call_candidate: 3,
    fixed_wait_candidate: 3,
    ts_ignore: 3,
    ts_nocheck: 3,
  },
}
const metricCap = 5
const contextMetrics = ['module_mock', 'vi_fn', 'vi_spyOn', 'testid_queries', 'css_dom_queries']
const contextMetricCap = 10
// Changing the review method must invalidate review decisions even without scanner/policy edits.
const reviewMethodSha256 = crypto.createHash('sha256')
for (const file of [
  __filename,
  '../SKILL.md',
  '../references/metrics.md',
  '../references/behavior-review.md',
]) {
  reviewMethodSha256.update(fs.readFileSync(path.resolve(__dirname, file)))
}
const reviewMethodHash = reviewMethodSha256.digest('hex')
function read(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (report.metricSchema !== 'frontend-test-maintenance-v4' || !Array.isArray(report.policies))
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
const usage =
  'Usage: node report.cjs rank AUDIT.json COUNT OUTPUT.json [REVIEWED.json] [--focus quality|typing|all]\n       node report.cjs compare BEFORE.json AFTER.json OUTPUT.json [FILES.txt]'
if (mode === '--help') {
  console.log(usage)
} else if (mode === 'rank') {
  const focusIndex = args.indexOf('--focus')
  const focus = focusIndex < 0 ? 'quality' : args[focusIndex + 1]
  if (!['quality', 'typing', 'all'].includes(focus))
    throw new Error('Invalid --focus; use quality, typing or all')
  if (focusIndex >= 0) args.splice(focusIndex, 2)
  const [input, countText, output, reviewedPath] = args
  const count = Number(countText)
  if (!input || !output || args.length > 4 || !Number.isInteger(count) || count < 1)
    throw new Error(usage)
  const dimensions =
    focus === 'typing'
      ? ['typing']
      : focus === 'quality'
        ? ['mock-boundary', 'behavior-value']
        : Object.keys(queueWeights)
  const report = read(input)
  const reviews = new Map()
  let reviewHistoryApplicable = false
  const legacyReviewFiles = []
  if (reviewedPath) {
    const history = JSON.parse(fs.readFileSync(reviewedPath, 'utf8'))
    if (!Array.isArray(history.files) || !Array.isArray(history.policies) || !history.scannerSha256)
      throw new Error(
        'Review history requires files, policies and scannerSha256; a ranked list is not a review record',
      )
    for (const entry of history.files) {
      if (!entry.file || !entry.sha256)
        throw new Error('Each reviewed file requires file and sha256')
      if (!entry.reviews) {
        legacyReviewFiles.push(entry.file)
        continue // Never promote whole-file decisions to unreviewed dimensions.
      }
      for (const [dimension, review] of Object.entries(entry.reviews)) {
        if (
          !queueWeights[dimension] ||
          !['retain', 'cleaned'].includes(review.decision) ||
          !review.reason?.trim()
        )
          throw new Error('Each dimension review requires retain/cleaned decision and a reason')
      }
      reviews.set(entry.file, entry)
    }
    reviewHistoryApplicable =
      history.scannerSha256 === report.scannerSha256 &&
      history.reviewMethodSha256 === reviewMethodHash &&
      JSON.stringify(history.policies) === JSON.stringify(report.policies)
  }
  const perFile = new Map(
    report.inventory.map((file) => [file.file, { ...file, metrics: {}, scores: {} }]),
  )
  for (const finding of report.findings) {
    const row = perFile.get(finding.file)
    row.metrics[finding.metric] = (row.metrics[finding.metric] || 0) + 1
  }
  const queues = Object.fromEntries(dimensions.map((dimension) => [dimension, []]))
  const deferredReviewed = []
  const staleReviewFiles = []
  for (const row of perFile.values()) {
    row.contextScore = contextMetrics.reduce(
      (sum, metric) => sum + Math.min(row.metrics[metric] || 0, contextMetricCap),
      0,
    )
    for (const [dimension, weights] of Object.entries(queueWeights)) {
      row.scores[dimension] = Object.entries(weights).reduce(
        (sum, [metric, weight]) => sum + Math.min(row.metrics[metric] || 0, metricCap) * weight,
        0,
      )
    }
    const review = reviews.get(row.file)
    const dependenciesCurrent =
      !review?.dependencies ||
      review.dependencies.every((dependency) => {
        const relative = path.relative(report.root, path.resolve(report.root, dependency.file))
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          throw new Error('Review dependency outside repository')
        const file = path.resolve(report.root, relative)
        return (
          fs.existsSync(file) &&
          crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') ===
            dependency.sha256
        )
      })
    const current =
      review && reviewHistoryApplicable && review.sha256 === row.sha256 && dependenciesCurrent
    if (review && !current) staleReviewFiles.push(row.file)
    for (const dimension of dimensions) {
      if (current && review.reviews[dimension]) {
        deferredReviewed.push({ file: row.file, dimension, ...review.reviews[dimension] })
      } else if (row.scores[dimension] > 0) {
        queues[dimension].push(row)
      }
    }
  }
  for (const [dimension, queue] of Object.entries(queues)) {
    queue.sort(
      (a, b) =>
        b.scores[dimension] - a.scores[dimension] ||
        b.contextScore - a.contextScore ||
        a.file.localeCompare(b.file),
    )
  }
  // Round-robin dimensions, deduplicating files; a typing backlog cannot monopolize quality.
  const candidates = []
  const seen = new Set()
  const cursors = Object.fromEntries(dimensions.map((dimension) => [dimension, 0]))
  while (candidates.length < count) {
    let added = false
    for (const dimension of dimensions) {
      const queue = queues[dimension]
      while (cursors[dimension] < queue.length && seen.has(queue[cursors[dimension]].file))
        cursors[dimension]++
      const row = queue[cursors[dimension]++]
      if (!row) continue
      seen.add(row.file)
      candidates.push({ ...row, selectedFrom: dimension })
      added = true
      if (candidates.length === count) break
    }
    if (!added) break
  }
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        purpose:
          'Static review queues, not confirmed violations or a deletion list. Trace behavior owners and overlapping tests before recommending edits.',
        commit: report.commit,
        requestedScopes: report.requestedScopes,
        policies: report.policies,
        scannerSha256: report.scannerSha256,
        reviewMethodSha256: reviewMethodHash,
        ranking: {
          focus,
          dimensions,
          queueWeights,
          metricCap,
          contextMetricCap,
          order:
            'Round-robin independent queues; per-queue score, capped context, path. Zero-signal files do not fill the quota.',
        },
        reviewHistoryApplicable,
        legacyReviewFiles,
        staleReviewFiles,
        deferredReviewed,
        queueSizes: Object.fromEntries(
          Object.entries(queues).map(([dimension, rows]) => [dimension, rows.length]),
        ),
        queues: Object.fromEntries(
          Object.entries(queues).map(([dimension, rows]) => [dimension, rows.slice(0, count)]),
        ),
        candidates,
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(`${output}.files.txt`, `${candidates.map((row) => row.file).join('\n')}\n`)
  console.log(
    JSON.stringify({
      output,
      manifest: `${output}.files.txt`,
      candidates: candidates.length,
      focus,
    }),
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
      : [...oldFiles.keys(), ...newFiles.keys()],
  )
  if (!selected.size) throw new Error('Empty comparison manifest')
  for (const file of selected)
    if (!oldFiles.has(file) && !newFiles.has(file))
      throw new Error(`File missing from both snapshots: ${file}`)
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
          status: !oldFiles.has(file)
            ? 'added'
            : !newFiles.has(file)
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
