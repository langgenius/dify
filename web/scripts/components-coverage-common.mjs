import fs from 'node:fs'
import path from 'node:path'
import { getLineHits, normalizeToRepoRelative } from './check-components-diff-coverage-lib.mjs'
import { collectComponentCoverageExcludedFiles } from './component-coverage-filters.mjs'
import { EXCLUDED_COMPONENT_MODULES } from './components-coverage-thresholds.mjs'

export const APP_COMPONENTS_ROOT = 'web/app/components'
export const APP_COMPONENTS_PREFIX = `${APP_COMPONENTS_ROOT}/`
export const APP_COMPONENTS_COVERAGE_PREFIX = 'app/components/'
export const SHARED_TEST_PREFIX = 'web/__tests__/'

export function createComponentCoverageContext(repoRoot) {
  const webRoot = path.join(repoRoot, 'web')
  const excludedComponentCoverageFiles = new Set(
    collectComponentCoverageExcludedFiles(path.join(webRoot, 'app/components'), { pathPrefix: APP_COMPONENTS_ROOT }),
  )

  return {
    excludedComponentCoverageFiles,
    repoRoot,
    webRoot,
  }
}

export function loadTrackedCoverageEntries(coverage, context) {
  const coverageEntries = new Map()

  for (const [file, entry] of Object.entries(coverage)) {
    const repoRelativePath = normalizeToRepoRelative(entry.path ?? file, {
      appComponentsCoveragePrefix: APP_COMPONENTS_COVERAGE_PREFIX,
      appComponentsPrefix: APP_COMPONENTS_PREFIX,
      repoRoot: context.repoRoot,
      sharedTestPrefix: SHARED_TEST_PREFIX,
      webRoot: context.webRoot,
    })

    if (!isTrackedComponentSourceFile(repoRelativePath, context.excludedComponentCoverageFiles))
      continue

    coverageEntries.set(repoRelativePath, entry)
  }

  return coverageEntries
}

export function collectTrackedComponentSourceFiles(context) {
  const trackedFiles = []

  walkComponentSourceFiles(path.join(context.webRoot, 'app/components'), (absolutePath) => {
    const repoRelativePath = path.relative(context.repoRoot, absolutePath).split(path.sep).join('/')
    if (isTrackedComponentSourceFile(repoRelativePath, context.excludedComponentCoverageFiles))
      trackedFiles.push(repoRelativePath)
  })

  trackedFiles.sort((a, b) => a.localeCompare(b))
  return trackedFiles
}

export function isTestLikePath(filePath) {
  return /(?:^|\/)__tests__\//.test(filePath)
    || /(?:^|\/)__mocks__\//.test(filePath)
    || /\.(?:spec|test)\.(?:ts|tsx)$/.test(filePath)
    || /\.stories\.(?:ts|tsx)$/.test(filePath)
    || /\.d\.ts$/.test(filePath)
}

export function getModuleName(filePath) {
  const relativePath = filePath.slice(APP_COMPONENTS_PREFIX.length)
  if (!relativePath)
    return '(root)'

  const segments = relativePath.split('/')
  return segments.length === 1 ? '(root)' : segments[0]
}

export function isAnyComponentSourceFile(filePath) {
  return filePath.startsWith(APP_COMPONENTS_PREFIX)
    && /\.(?:ts|tsx)$/.test(filePath)
    && !isTestLikePath(filePath)
}

export function isExcludedComponentSourceFile(filePath, excludedComponentCoverageFiles) {
  return isAnyComponentSourceFile(filePath)
    && (
      EXCLUDED_COMPONENT_MODULES.has(getModuleName(filePath))
      || excludedComponentCoverageFiles.has(filePath)
    )
}

export function isTrackedComponentSourceFile(filePath, excludedComponentCoverageFiles) {
  return isAnyComponentSourceFile(filePath)
    && !isExcludedComponentSourceFile(filePath, excludedComponentCoverageFiles)
}

export function isTrackedComponentTestFile(filePath) {
  return filePath.startsWith(APP_COMPONENTS_PREFIX)
    && isTestLikePath(filePath)
    && !EXCLUDED_COMPONENT_MODULES.has(getModuleName(filePath))
}

export function isRelevantTestFile(filePath) {
  return filePath.startsWith(SHARED_TEST_PREFIX)
    || isTrackedComponentTestFile(filePath)
}

export function isAnyWebTestFile(filePath) {
  return filePath.startsWith('web/')
    && isTestLikePath(filePath)
}

export function getCoverageStats(entry) {
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

export function sumCoverageStats(rows) {
  const total = createEmptyCoverageStats()
  for (const row of rows)
    addCoverageStats(total, row)
  return total
}

export function mergeCoverageStats(map, moduleName, stats) {
  const existing = map.get(moduleName) ?? createEmptyCoverageStats()
  addCoverageStats(existing, stats)
  map.set(moduleName, existing)
}

export function percentage(covered, total) {
  if (total === 0)
    return 100
  return (covered / total) * 100
}

export function formatPercent(metric) {
  return `${percentage(metric.covered, metric.total).toFixed(2)}%`
}

function createEmptyCoverageStats() {
  return {
    lines: { covered: 0, total: 0 },
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
  }
}

function addCoverageStats(target, source) {
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    target[metric].covered += source[metric].covered
    target[metric].total += source[metric].total
  }
}

function walkComponentSourceFiles(currentDir, onFile) {
  if (!fs.existsSync(currentDir))
    return

  const entries = fs.readdirSync(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__')
        continue
      walkComponentSourceFiles(entryPath, onFile)
      continue
    }

    if (!/\.(?:ts|tsx)$/.test(entry.name) || isTestLikePath(entry.name))
      continue

    onFile(entryPath)
  }
}
