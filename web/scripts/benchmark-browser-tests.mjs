import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Temporary draft-PR experiment. Runs sequentially inside an existing browser job.
if (!process.env.CI || !process.env.RUNNER_TEMP) {
  throw new Error('Run this experiment in the existing GitHub Actions browser job')
}

const files = [
  'app/components/base/prompt-editor/plugins/agent-output-block/__tests__/component.browser.spec.tsx',
  'app/components/base/auto-height-textarea/__tests__/index.browser.spec.tsx',
  'app/components/header/account-menu/__tests__/focus.browser.spec.tsx',
  'app/(auth)/device/components/__tests__/code-input.browser.spec.tsx',
  'app/components/app-sidebar/__tests__/app-detail-top.browser.spec.tsx',
  'app/components/apps/__tests__/app-creation-url.browser.spec.tsx',
  'app/components/base/chat/chat/answer/__tests__/agent-content.browser.spec.tsx',
  'app/components/base/date-time-picker/__tests__/localization.browser.spec.tsx',
  'app/components/base/form/components/base/__tests__/base-field-choices.browser.spec.tsx',
  'app/components/base/image-uploader/__tests__/image-preview.browser.spec.tsx',
  'app/components/base/param-item/__tests__/score-threshold-item.browser.spec.tsx',
  'app/components/datasets/create/website/base/__tests__/checkbox-with-label.browser.spec.tsx',
  'app/components/header/account-setting/model-provider-page/provider-added-card/__tests__/focus.browser.spec.tsx',
  'app/components/plugins/marketplace/home/__tests__/marketplace-live-search.browser.spec.tsx',
  'app/components/workflow/hooks/__tests__/selection-interactions.browser.spec.tsx',
  'app/components/workflow/nodes/human-input/components/__tests__/timeout.browser.spec.tsx',
  'features/agent-v2/agent-detail/configure/components/__tests__/agent-prompt-editor.browser.spec.tsx',
  'features/new-rag/list/__tests__/new-knowledge-list.collection.browser.spec.tsx',
]

const variants = [
  { name: 'baseline' },
  { name: 'no-trace', trace: 'off' },
  { name: 'no-coverage', coverage: false },
  { name: 'no-dependency-sourcemaps', dependencySourcemaps: false },
  { name: 'two-workers', workers: 2 },
  { name: 'executed-coverage-only', executedCoverage: true },
  { name: 'trace-without-filmstrip', filmstrip: false },
  {
    name: 'combined',
    dependencySourcemaps: false,
    executedCoverage: true,
    filmstrip: false,
  },
]

const output = resolve('.vitest-browser/performance')
const temporary = resolve(process.env.RUNNER_TEMP, 'dify-browser-performance')
mkdirSync(output, { recursive: true })
mkdirSync(temporary, { recursive: true })
const rows = []
let referenceTests
let referenceCoveredFiles

for (let round = 1; round <= 2; round++) {
  const order = round === 1 ? variants : [...variants].reverse()
  for (const variant of order) {
    const label = `${variant.name}-${round}`
    const directory = resolve(temporary, label)
    mkdirSync(directory, { recursive: true })
    const config = resolve(directory, 'vite.config.mts')
    const report = resolve(directory, 'results.json')
    const coverageDirectory = resolve(directory, 'coverage')
    writeFileSync(
      config,
      `import config from ${JSON.stringify(resolve('vite.config.ts'))}
export default async (environment) => {
  const base = typeof config === 'function' ? await config(environment) : await config
  const projects = base.test.projects.map(project => project.test.name !== 'browser' ? project : {
    ...project,
    test: { ...project.test, browser: {
      ...project.test.browser,
      dependencySourcemaps: ${variant.dependencySourcemaps ?? true},
      trace: {
        ...project.test.browser.trace,
        mode: ${JSON.stringify(variant.trace ?? 'retain-on-failure')},
        screenshots: ${variant.filmstrip ?? true},
      },
    } },
  })
  return { ...base, test: {
    ...base.test,
    projects,
    coverage: { ...base.test.coverage, ${variant.executedCoverage ? 'include: undefined,' : ''} },
  } }
}
`,
    )
    const args = [
      'test', 'run', '--project', 'browser', '--config', config,
      `--maxWorkers=${variant.workers ?? 4}`,
      `--coverage=${variant.coverage ?? true}`,
      `--coverage.reportsDirectory=${coverageDirectory}`,
      '--reporter=json', `--outputFile=${report}`, ...files,
    ]
    const start = performance.now()
    console.log(`::group::${label}`)
    const result = spawnSync('vp', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    writeFileSync(resolve(directory, 'run.log'), `${result.stdout ?? ''}${result.stderr ?? ''}`)
    const row = { variant: variant.name, round, seconds: (performance.now() - start) / 1000, exit: result.status }
    try {
      const data = JSON.parse(readFileSync(report, 'utf8'))
      row.tests = data.numTotalTests
      row.failedTests = data.numFailedTests
      row.success = data.success
      referenceTests ??= row.tests
      if (row.tests !== referenceTests) throw new Error('The test inventory changed')
      if (variant.coverage !== false) {
        const coverage = JSON.parse(readFileSync(resolve(coverageDirectory, 'coverage-final.json'), 'utf8'))
        const coveredFiles = Object.entries(coverage)
          .filter(([, entry]) => Object.values(entry.s).some(count => count > 0))
          .map(([filename]) => filename)
        row.coverageFiles = Object.keys(coverage).length
        row.coveredFiles = coveredFiles.length
        referenceCoveredFiles ??= new Set(coveredFiles)
        if (variant.executedCoverage) {
          const covered = new Set(coveredFiles)
          row.missingCoveredFiles = [...referenceCoveredFiles].filter(filename => !covered.has(filename))
          if (row.missingCoveredFiles.length) throw new Error('Executed coverage omitted previously covered files')
        }
      }
    } catch (error) {
      row.error = String(error)
    }
    rows.push(row)
    writeFileSync(resolve(output, 'results.json'), JSON.stringify(rows, null, 2))
    console.log(JSON.stringify(row))
    console.log('::endgroup::')
    if (row.exit !== 0 || row.failedTests || row.error || !row.success) {
      console.log(result.stdout, result.stderr)
      process.exitCode = 1
      break
    }
  }
  if (process.exitCode) break
}

const lines = ['## Browser runtime experiment', '', '| Variant | Round 1 | Round 2 | Mean |', '| --- | ---: | ---: | ---: |']
for (const variant of variants) {
  const runs = rows.filter(row => row.variant === variant.name)
  const seconds = runs.map(row => row.seconds)
  lines.push(`| ${variant.name} | ${seconds[0]?.toFixed(2) ?? '-'}s | ${seconds[1]?.toFixed(2) ?? '-'}s | ${(seconds.reduce((sum, value) => sum + value, 0) / seconds.length).toFixed(2)}s |`)
}
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`)
