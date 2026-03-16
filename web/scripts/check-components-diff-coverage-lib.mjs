import fs from 'node:fs'
import path from 'node:path'

const DIFF_COVERAGE_IGNORE_LINE_TOKEN = 'diff-coverage-ignore-line:'

export function buildGitDiffRevisionArgs(base, head, mode = 'merge-base') {
  return mode === 'exact'
    ? [base, head]
    : [`${base}...${head}`]
}

export function parseChangedLineMap(diff, isTrackedComponentSourceFile) {
  const lineMap = new Map()
  let currentFile = null

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6).trim()
      continue
    }

    if (!currentFile || !isTrackedComponentSourceFile(currentFile))
      continue

    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (!match)
      continue

    const start = Number(match[1])
    const count = match[2] ? Number(match[2]) : 1
    if (count === 0)
      continue

    const linesForFile = lineMap.get(currentFile) ?? new Set()
    for (let offset = 0; offset < count; offset += 1)
      linesForFile.add(start + offset)
    lineMap.set(currentFile, linesForFile)
  }

  return lineMap
}

export function normalizeToRepoRelative(filePath, {
  appComponentsCoveragePrefix,
  appComponentsPrefix,
  repoRoot,
  sharedTestPrefix,
  webRoot,
}) {
  if (!filePath)
    return ''

  if (filePath.startsWith(appComponentsPrefix) || filePath.startsWith(sharedTestPrefix))
    return filePath

  if (filePath.startsWith(appComponentsCoveragePrefix))
    return `web/${filePath}`

  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(webRoot, filePath)

  return path.relative(repoRoot, absolutePath).split(path.sep).join('/')
}

export function getLineHits(entry) {
  if (entry?.l && Object.keys(entry.l).length > 0)
    return entry.l

  const lineHits = {}
  for (const [statementId, statement] of Object.entries(entry?.statementMap ?? {})) {
    const line = statement?.start?.line
    if (!line)
      continue

    const hits = entry?.s?.[statementId] ?? 0
    const previous = lineHits[line]
    lineHits[line] = previous === undefined ? hits : Math.max(previous, hits)
  }

  return lineHits
}

export function getChangedStatementCoverage(entry, changedLines) {
  const normalizedChangedLines = [...(changedLines ?? [])].sort((a, b) => a - b)
  if (!entry) {
    return {
      covered: 0,
      total: normalizedChangedLines.length,
      uncoveredLines: normalizedChangedLines,
    }
  }

  const uncoveredLines = []
  let covered = 0
  let total = 0

  for (const [statementId, statement] of Object.entries(entry.statementMap ?? {})) {
    if (!rangeIntersectsChangedLines(statement, changedLines))
      continue

    total += 1
    const hits = entry.s?.[statementId] ?? 0
    if (hits > 0) {
      covered += 1
      continue
    }

    uncoveredLines.push(getFirstChangedLineInRange(statement, normalizedChangedLines))
  }

  return {
    covered,
    total,
    uncoveredLines: uncoveredLines.sort((a, b) => a - b),
  }
}

export function getChangedBranchCoverage(entry, changedLines) {
  const normalizedChangedLines = [...(changedLines ?? [])].sort((a, b) => a - b)
  if (!entry) {
    return {
      covered: 0,
      total: 0,
      uncoveredBranches: [],
    }
  }

  const uncoveredBranches = []
  let covered = 0
  let total = 0

  for (const [branchId, branch] of Object.entries(entry.branchMap ?? {})) {
    const hits = Array.isArray(entry.b?.[branchId]) ? entry.b[branchId] : []
    const locations = getBranchLocations(branch)
    const armCount = Math.max(locations.length, hits.length)
    const impactedArmIndexes = getImpactedBranchArmIndexes(branch, changedLines, armCount)

    if (impactedArmIndexes.length === 0)
      continue

    for (const armIndex of impactedArmIndexes) {
      total += 1
      if ((hits[armIndex] ?? 0) > 0) {
        covered += 1
        continue
      }

      const location = locations[armIndex] ?? branch.loc ?? branch
      uncoveredBranches.push({
        armIndex,
        line: getFirstChangedLineInRange(location, normalizedChangedLines, branch.line ?? 1),
      })
    }
  }

  uncoveredBranches.sort((a, b) => a.line - b.line || a.armIndex - b.armIndex)
  return {
    covered,
    total,
    uncoveredBranches,
  }
}

export function getIgnoredChangedLinesFromFile(filePath, changedLines) {
  if (!fs.existsSync(filePath))
    return emptyIgnoreResult(changedLines)

  const sourceCode = fs.readFileSync(filePath, 'utf8')
  return getIgnoredChangedLinesFromSource(sourceCode, changedLines)
}

export function getIgnoredChangedLinesFromSource(sourceCode, changedLines) {
  const ignoredLines = new Map()
  const invalidPragmas = []
  const changedLineSet = new Set(changedLines ?? [])

  const sourceLines = sourceCode.split('\n')
  sourceLines.forEach((lineText, index) => {
    const lineNumber = index + 1
    const commentIndex = lineText.indexOf('//')
    if (commentIndex < 0)
      return

    const tokenIndex = lineText.indexOf(DIFF_COVERAGE_IGNORE_LINE_TOKEN, commentIndex + 2)
    if (tokenIndex < 0)
      return

    const reason = lineText.slice(tokenIndex + DIFF_COVERAGE_IGNORE_LINE_TOKEN.length).trim()
    if (!changedLineSet.has(lineNumber))
      return

    if (!reason) {
      invalidPragmas.push({
        line: lineNumber,
        reason: 'missing ignore reason',
      })
      return
    }

    ignoredLines.set(lineNumber, reason)
  })

  const effectiveChangedLines = new Set(
    [...changedLineSet].filter(lineNumber => !ignoredLines.has(lineNumber)),
  )

  return {
    effectiveChangedLines,
    ignoredLines,
    invalidPragmas,
  }
}

function emptyIgnoreResult(changedLines = []) {
  return {
    effectiveChangedLines: new Set(changedLines),
    ignoredLines: new Map(),
    invalidPragmas: [],
  }
}

function getBranchLocations(branch) {
  return Array.isArray(branch?.locations) ? branch.locations.filter(Boolean) : []
}

function getImpactedBranchArmIndexes(branch, changedLines, armCount) {
  if (!changedLines || changedLines.size === 0 || armCount === 0)
    return []

  const locations = getBranchLocations(branch)
  if (isWholeBranchTouched(branch, changedLines, locations, armCount))
    return Array.from({ length: armCount }, (_, armIndex) => armIndex)

  const impactedArmIndexes = []
  for (let armIndex = 0; armIndex < armCount; armIndex += 1) {
    const location = locations[armIndex]
    if (rangeIntersectsChangedLines(location, changedLines))
      impactedArmIndexes.push(armIndex)
  }

  return impactedArmIndexes
}

function isWholeBranchTouched(branch, changedLines, locations, armCount) {
  if (!changedLines || changedLines.size === 0)
    return false

  if (branch.line && changedLines.has(branch.line))
    return true

  const branchRange = branch.loc ?? branch
  if (!rangeIntersectsChangedLines(branchRange, changedLines))
    return false

  if (locations.length === 0 || locations.length < armCount)
    return true

  for (const lineNumber of changedLines) {
    if (!lineTouchesLocation(lineNumber, branchRange))
      continue
    if (!locations.some(location => lineTouchesLocation(lineNumber, location)))
      return true
  }

  return false
}

function rangeIntersectsChangedLines(location, changedLines) {
  if (!location || !changedLines || changedLines.size === 0)
    return false

  const startLine = getLocationStartLine(location)
  const endLine = getLocationEndLine(location) ?? startLine
  if (!startLine || !endLine)
    return false

  for (const lineNumber of changedLines) {
    if (lineNumber >= startLine && lineNumber <= endLine)
      return true
  }

  return false
}

function getFirstChangedLineInRange(location, changedLines, fallbackLine = 1) {
  const startLine = getLocationStartLine(location)
  const endLine = getLocationEndLine(location) ?? startLine
  if (!startLine || !endLine)
    return startLine ?? fallbackLine

  for (const lineNumber of changedLines) {
    if (lineNumber >= startLine && lineNumber <= endLine)
      return lineNumber
  }

  return startLine ?? fallbackLine
}

function lineTouchesLocation(lineNumber, location) {
  const startLine = getLocationStartLine(location)
  const endLine = getLocationEndLine(location) ?? startLine
  if (!startLine || !endLine)
    return false

  return lineNumber >= startLine && lineNumber <= endLine
}

function getLocationStartLine(location) {
  return location?.start?.line ?? location?.line ?? null
}

function getLocationEndLine(location) {
  return location?.end?.line ?? location?.line ?? null
}
