/**
 * Component Analyzer - Shared module for analyzing React component complexity
 *
 * This module is used by:
 * - analyze-component.js (for test generation)
 * - refactor-component.js (for refactoring suggestions)
 */

import fs from 'node:fs'
import path from 'node:path'
import tsParser from '@typescript-eslint/parser'
import { Linter } from 'eslint'
import sonarPlugin from 'eslint-plugin-sonarjs'

// ============================================================================
// Component Analyzer
// ============================================================================

export class ComponentAnalyzer {
  analyze(code, filePath, absolutePath) {
    const resolvedPath = absolutePath ?? path.resolve(process.cwd(), filePath)
    const fileName = path.basename(filePath, path.extname(filePath))
    const lineCount = code.split('\n').length
    const hasReactQuery = /\buse(?:Query|Queries|InfiniteQuery|SuspenseQuery|SuspenseInfiniteQuery|Mutation)\b/.test(code)

    // Calculate complexity metrics
    const { total: rawComplexity, max: rawMaxComplexity } = this.calculateCognitiveComplexity(code)
    const complexity = this.normalizeComplexity(rawComplexity)
    const maxComplexity = this.normalizeComplexity(rawMaxComplexity)

    // Count usage references (may take a few seconds)
    const usageCount = this.countUsageReferences(filePath, resolvedPath)

    // Calculate test priority
    const priority = this.calculateTestPriority(complexity, usageCount)

    return {
      name: fileName.charAt(0).toUpperCase() + fileName.slice(1),
      path: filePath,
      type: this.detectType(filePath, code),
      hasProps: code.includes('Props') || code.includes('interface'),
      hasState: code.includes('useState') || code.includes('useReducer'),
      hasEffects: code.includes('useEffect'),
      hasCallbacks: code.includes('useCallback'),
      hasMemo: code.includes('useMemo'),
      hasEvents: /on[A-Z]\w+/.test(code),
      hasRouter: code.includes('useRouter') || code.includes('usePathname'),
      hasAPI: code.includes('service/') || code.includes('fetch(') || hasReactQuery,
      hasForwardRef: code.includes('forwardRef'),
      hasComponentMemo: /React\.memo|memo\(/.test(code),
      hasSuspense: code.includes('Suspense') || /\blazy\(/.test(code),
      hasPortal: code.includes('createPortal'),
      hasImperativeHandle: code.includes('useImperativeHandle'),
      hasReactQuery,
      hasAhooks: code.includes('from \'ahooks\''),
      complexity,
      maxComplexity,
      rawComplexity,
      rawMaxComplexity,
      lineCount,
      usageCount,
      priority,
    }
  }

  detectType(filePath, code) {
    const normalizedPath = filePath.replace(/\\/g, '/')
    if (normalizedPath.includes('/hooks/'))
      return 'hook'
    if (normalizedPath.includes('/utils/'))
      return 'util'
    if (/\/page\.(t|j)sx?$/.test(normalizedPath))
      return 'page'
    if (/\/layout\.(t|j)sx?$/.test(normalizedPath))
      return 'layout'
    if (/\/providers?\//.test(normalizedPath))
      return 'provider'
    // Dify-specific types
    if (normalizedPath.includes('/components/base/'))
      return 'base-component'
    if (normalizedPath.includes('/context/'))
      return 'context'
    if (normalizedPath.includes('/store/'))
      return 'store'
    if (normalizedPath.includes('/service/'))
      return 'service'
    if (/use[A-Z]\w+/.test(code))
      return 'component'
    return 'component'
  }

  /**
   * Calculate Cognitive Complexity using SonarJS ESLint plugin
   * Reference: https://www.sonarsource.com/blog/5-clean-code-tips-for-reducing-cognitive-complexity/
   *
   * Returns raw (unnormalized) complexity values:
   *   - total: sum of all functions' complexity in the file
   *   - max: highest single function complexity in the file
   *
   * Raw Score Thresholds (per function):
   *   0-15: Simple | 16-30: Medium | 31-50: Complex | 51+: Very Complex
   *
   * @returns {{ total: number, max: number }} raw total and max complexity
   */
  calculateCognitiveComplexity(code) {
    const linter = new Linter()
    const baseConfig = {
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          ecmaFeatures: { jsx: true },
        },
      },
      plugins: { sonarjs: sonarPlugin },
    }

    try {
      // Get total complexity using 'metric' option (more stable)
      const totalConfig = {
        ...baseConfig,
        rules: { 'sonarjs/cognitive-complexity': ['error', 0, 'metric'] },
      }
      const totalMessages = linter.verify(code, totalConfig)
      const totalMsg = totalMessages.find(
        msg => msg.ruleId === 'sonarjs/cognitive-complexity'
          && msg.messageId === 'fileComplexity',
      )
      const total = totalMsg ? Number.parseInt(totalMsg.message, 10) : 0

      // Get max function complexity by analyzing each function
      const maxConfig = {
        ...baseConfig,
        rules: { 'sonarjs/cognitive-complexity': ['error', 0] },
      }
      const maxMessages = linter.verify(code, maxConfig)
      let max = 0
      const complexityPattern = /reduce its Cognitive Complexity from (\d+)/

      maxMessages.forEach((msg) => {
        if (msg.ruleId === 'sonarjs/cognitive-complexity') {
          const match = msg.message.match(complexityPattern)
          if (match && match[1])
            max = Math.max(max, Number.parseInt(match[1], 10))
        }
      })

      return { total, max }
    }
    catch {
      return { total: 0, max: 0 }
    }
  }

  /**
   * Normalize cognitive complexity to 0-100 scale
   *
   * Mapping (aligned with SonarJS thresholds):
   *   Raw 0-15 (Simple)       -> Normalized 0-25
   *   Raw 16-30 (Medium)      -> Normalized 25-50
   *   Raw 31-50 (Complex)     -> Normalized 50-75
   *   Raw 51+ (Very Complex)  -> Normalized 75-100 (asymptotic)
   */
  normalizeComplexity(rawComplexity) {
    if (rawComplexity <= 15) {
      // Linear: 0-15 -> 0-25
      return Math.round((rawComplexity / 15) * 25)
    }
    else if (rawComplexity <= 30) {
      // Linear: 16-30 -> 25-50
      return Math.round(25 + ((rawComplexity - 15) / 15) * 25)
    }
    else if (rawComplexity <= 50) {
      // Linear: 31-50 -> 50-75
      return Math.round(50 + ((rawComplexity - 30) / 20) * 25)
    }
    else {
      // Asymptotic: 51+ -> 75-100
      // Formula ensures score approaches but never exceeds 100
      return Math.round(75 + 25 * (1 - 1 / (1 + (rawComplexity - 50) / 100)))
    }
  }

  /**
   * Count how many times a component is referenced in the codebase
   * Scans TypeScript sources for import statements referencing the component
   */
  countUsageReferences(filePath, absolutePath) {
    try {
      const resolvedComponentPath = absolutePath ?? path.resolve(process.cwd(), filePath)
      const fileName = path.basename(resolvedComponentPath, path.extname(resolvedComponentPath))

      let searchName = fileName
      if (fileName === 'index') {
        const parentDir = path.dirname(resolvedComponentPath)
        searchName = path.basename(parentDir)
      }

      if (!searchName)
        return 0

      const searchRoots = this.collectSearchRoots(resolvedComponentPath)
      if (searchRoots.length === 0)
        return 0

      const escapedName = ComponentAnalyzer.escapeRegExp(searchName)
      const patterns = [
        new RegExp(`from\\s+['\"][^'\"]*(?:/|^)${escapedName}(?:['\"/]|$)`),
        new RegExp(`import\\s*\\(\\s*['\"][^'\"]*(?:/|^)${escapedName}(?:['\"/]|$)`),
        new RegExp(`export\\s+(?:\\*|{[^}]*})\\s*from\\s+['\"][^'\"]*(?:/|^)${escapedName}(?:['\"/]|$)`),
        new RegExp(`require\\(\\s*['\"][^'\"]*(?:/|^)${escapedName}(?:['\"/]|$)`),
      ]

      const visited = new Set()
      let usageCount = 0

      const stack = [...searchRoots]
      while (stack.length > 0) {
        const currentDir = stack.pop()
        if (!currentDir || visited.has(currentDir))
          continue
        visited.add(currentDir)

        const entries = fs.readdirSync(currentDir, { withFileTypes: true })

        entries.forEach((entry) => {
          const entryPath = path.join(currentDir, entry.name)

          if (entry.isDirectory()) {
            if (this.shouldSkipDir(entry.name))
              return
            stack.push(entryPath)
            return
          }

          if (!this.shouldInspectFile(entry.name))
            return

          const normalizedEntryPath = path.resolve(entryPath)
          if (normalizedEntryPath === path.resolve(resolvedComponentPath))
            return

          const source = fs.readFileSync(entryPath, 'utf-8')
          if (!source.includes(searchName))
            return

          if (patterns.some((pattern) => {
            pattern.lastIndex = 0
            return pattern.test(source)
          })) {
            usageCount += 1
          }
        })
      }

      return usageCount
    }
    catch {
      // If command fails, return 0
      return 0
    }
  }

  collectSearchRoots(resolvedComponentPath) {
    const roots = new Set()

    let currentDir = path.dirname(resolvedComponentPath)
    const workspaceRoot = process.cwd()

    while (currentDir && currentDir !== path.dirname(currentDir)) {
      if (path.basename(currentDir) === 'app') {
        roots.add(currentDir)
        break
      }

      if (currentDir === workspaceRoot)
        break
      currentDir = path.dirname(currentDir)
    }

    const fallbackRoots = [
      path.join(workspaceRoot, 'app'),
      path.join(workspaceRoot, 'web', 'app'),
      path.join(workspaceRoot, 'src'),
    ]

    fallbackRoots.forEach((root) => {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory())
        roots.add(root)
    })

    return Array.from(roots)
  }

  shouldSkipDir(dirName) {
    const normalized = dirName.toLowerCase()
    return [
      'node_modules',
      '.git',
      '.next',
      'dist',
      'out',
      'coverage',
      'build',
      '__tests__',
      '__mocks__',
    ].includes(normalized)
  }

  shouldInspectFile(fileName) {
    const normalized = fileName.toLowerCase()
    if (!(/\.(ts|tsx)$/i.test(fileName)))
      return false
    if (normalized.endsWith('.d.ts'))
      return false
    if (/\.(spec|test)\.(ts|tsx)$/.test(normalized))
      return false
    if (normalized.endsWith('.stories.tsx'))
      return false
    return true
  }

  static escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Calculate test priority based on cognitive complexity and usage
   *
   * Priority Score = 0.7 * Complexity + 0.3 * Usage Score (all normalized to 0-100)
   * - Complexity Score: 0-100 (normalized from SonarJS)
   * - Usage Score: 0-100 (based on reference count)
   *
   * Priority Levels (0-100):
   * - 0-25: 🟢 LOW
   * - 26-50: 🟡 MEDIUM
   * - 51-75: 🟠 HIGH
   * - 76-100: 🔴 CRITICAL
   */
  calculateTestPriority(complexity, usageCount) {
    const complexityScore = complexity

    // Normalize usage score to 0-100
    let usageScore
    if (usageCount === 0)
      usageScore = 0
    else if (usageCount <= 5)
      usageScore = 20
    else if (usageCount <= 20)
      usageScore = 40
    else if (usageCount <= 50)
      usageScore = 70
    else
      usageScore = 100

    // Weighted average: complexity (70%) + usage (30%)
    const totalScore = Math.round(0.7 * complexityScore + 0.3 * usageScore)

    return {
      score: totalScore,
      level: this.getPriorityLevel(totalScore),
      usageScore,
      complexityScore,
    }
  }

  /**
   * Get priority level based on score (0-100 scale)
   */
  getPriorityLevel(score) {
    if (score > 75)
      return '🔴 CRITICAL'
    if (score > 50)
      return '🟠 HIGH'
    if (score > 25)
      return '🟡 MEDIUM'
    return '🟢 LOW'
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve directory to entry file
 * Priority: index files > common entry files (node.tsx, panel.tsx, etc.)
 */
export function resolveDirectoryEntry(absolutePath, componentPath) {
  // Entry files in priority order: index files first, then common entry files
  const entryFiles = [
    'index.tsx',
    'index.ts', // Priority 1: index files
    'node.tsx',
    'panel.tsx',
    'component.tsx',
    'main.tsx',
    'container.tsx', // Priority 2: common entry files
  ]
  for (const entryFile of entryFiles) {
    const entryPath = path.join(absolutePath, entryFile)
    if (fs.existsSync(entryPath)) {
      return {
        absolutePath: entryPath,
        componentPath: path.join(componentPath, entryFile),
      }
    }
  }

  return null
}

/**
 * List analyzable files in directory (for user guidance)
 */
export function listAnalyzableFiles(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries
      .filter(entry => !entry.isDirectory() && /\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
      .map(entry => entry.name)
      .sort((a, b) => {
        // Prioritize common entry files
        const priority = ['index.tsx', 'index.ts', 'node.tsx', 'panel.tsx', 'component.tsx', 'main.tsx', 'container.tsx']
        const aIdx = priority.indexOf(a)
        const bIdx = priority.indexOf(b)
        if (aIdx !== -1 && bIdx !== -1)
          return aIdx - bIdx
        if (aIdx !== -1)
          return -1
        if (bIdx !== -1)
          return 1
        return a.localeCompare(b)
      })
  }
  catch {
    return []
  }
}

/**
 * Extract copy content from prompt (for clipboard)
 */
export function extractCopyContent(prompt) {
  const marker = '📋 PROMPT FOR AI ASSISTANT (COPY THIS TO YOUR AI ASSISTANT):'
  const markerIndex = prompt.indexOf(marker)
  if (markerIndex === -1)
    return ''

  const section = prompt.slice(markerIndex)
  const lines = section.split('\n')
  const firstDivider = lines.findIndex(line => line.includes('━━━━━━━━'))
  if (firstDivider === -1)
    return ''

  const startIdx = firstDivider + 1
  let endIdx = lines.length

  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].includes('━━━━━━━━')) {
      endIdx = i
      break
    }
  }

  if (startIdx >= endIdx)
    return ''

  return lines.slice(startIdx, endIdx).join('\n').trim()
}

/**
 * Get complexity level label
 */
export function getComplexityLevel(score) {
  if (score <= 25)
    return '🟢 Simple'
  if (score <= 50)
    return '🟡 Medium'
  if (score <= 75)
    return '🟠 Complex'
  return '🔴 Very Complex'
}
