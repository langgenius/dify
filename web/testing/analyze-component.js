#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

// ============================================================================
// Simple Analyzer
// ============================================================================

class ComponentAnalyzer {
  analyze(code, filePath, absolutePath) {
    const resolvedPath = absolutePath ?? path.resolve(process.cwd(), filePath)
    const fileName = path.basename(filePath, path.extname(filePath))
    const lineCount = code.split('\n').length
    const complexity = this.calculateComplexity(code, lineCount)

    // Count usage references (may take a few seconds)
    const usageCount = this.countUsageReferences(filePath, resolvedPath)

    // Calculate test priority
    const priority = this.calculateTestPriority(complexity, usageCount)

    return {
      name: fileName.charAt(0).toUpperCase() + fileName.slice(1),
      path: filePath,
      type: this.detectType(filePath, code),
      hasProps: code.includes('Props') || code.includes('interface'),
      hasState: code.includes('useState'),
      hasEffects: code.includes('useEffect'),
      hasCallbacks: code.includes('useCallback'),
      hasMemo: code.includes('useMemo'),
      hasEvents: /on[A-Z]\w+/.test(code),
      hasRouter: code.includes('useRouter') || code.includes('usePathname'),
      hasAPI: code.includes('service/') || code.includes('fetch('),
      complexity,
      lineCount,
      usageCount,
      priority,
    }
  }

  detectType(filePath, code) {
    const normalizedPath = filePath.replace(/\\/g, '/')
    if (normalizedPath.includes('/hooks/')) return 'hook'
    if (normalizedPath.includes('/utils/')) return 'util'
    if (/\/page\.(t|j)sx?$/.test(normalizedPath)) return 'page'
    if (/\/layout\.(t|j)sx?$/.test(normalizedPath)) return 'layout'
    if (/\/providers?\//.test(normalizedPath)) return 'provider'
    if (/use[A-Z]\w+/.test(code)) return 'component'
    return 'component'
  }

  /**
   * Calculate component complexity score
   * Based on Cognitive Complexity + React-specific metrics
   *
   * Score Ranges:
   *   0-10: 🟢 Simple (5-10 min to test)
   *   11-30: 🟡 Medium (15-30 min to test)
   *   31-50: 🟠 Complex (30-60 min to test)
   *   51+: 🔴 Very Complex (60+ min, consider splitting)
   */
  calculateComplexity(code, lineCount) {
    let score = 0

    const count = pattern => this.countMatches(code, pattern)

    // ===== React Hooks (State Management Complexity) =====
    const stateHooks = count(/useState/g)
    const effectHooks = count(/useEffect/g)
    const callbackHooks = count(/useCallback/g)
    const memoHooks = count(/useMemo/g)
    const refHooks = count(/useRef/g)
    const totalHooks = count(/use[A-Z]\w+/g)
    const customHooks = Math.max(0, totalHooks - (stateHooks + effectHooks + callbackHooks + memoHooks + refHooks))

    score += stateHooks * 5 // Each state +5 (need to test state changes)
    score += effectHooks * 6 // Each effect +6 (need to test deps & cleanup)
    score += callbackHooks * 2 // Each callback +2
    score += memoHooks * 2 // Each memo +2
    score += refHooks * 1 // Each ref +1
    score += customHooks * 3 // Each custom hook +3

    // ===== Control Flow Complexity (Cyclomatic Complexity) =====
    score += count(/if\s*\(/g) * 2 // if statement
    score += count(/else\s+if/g) * 2 // else if
    score += count(/\?\s*[^:]+\s*:/g) * 1 // ternary operator
    score += count(/switch\s*\(/g) * 3 // switch
    score += count(/case\s+/g) * 1 // case branch
    score += count(/&&/g) * 1 // logical AND
    score += count(/\|\|/g) * 1 // logical OR
    score += count(/\?\?/g) * 1 // nullish coalescing

    // ===== Loop Complexity =====
    score += count(/\.map\(/g) * 2 // map
    score += count(/\.filter\(/g) * 1 // filter
    score += count(/\.reduce\(/g) * 3 // reduce (complex)
    score += count(/for\s*\(/g) * 2 // for loop
    score += count(/while\s*\(/g) * 3 // while loop

    // ===== Props and Events Complexity =====
    const propsMatches = this.countMatches(code, /(\w+)\s*:\s*\w+/g)
    const propsCount = Math.min(propsMatches, 20) // Max 20 props
    score += Math.floor(propsCount / 2) // Every 2 props +1

    const eventHandlers = count(/on[A-Z]\w+/g)
    score += eventHandlers * 2 // Each event handler +2

    // ===== API Call Complexity =====
    score += count(/fetch\(/g) * 4 // fetch
    score += count(/axios\./g) * 4 // axios
    score += count(/useSWR/g) * 4 // SWR
    score += count(/useQuery/g) * 4 // React Query
    score += count(/\.then\(/g) * 2 // Promise
    score += count(/await\s+/g) * 2 // async/await

    // ===== Third-party Library Integration =====
    const integrations = [
      { pattern: /reactflow|ReactFlow/, weight: 15 },
      { pattern: /@monaco-editor/, weight: 12 },
      { pattern: /echarts/, weight: 8 },
      { pattern: /lexical/, weight: 10 },
    ]

    integrations.forEach(({ pattern, weight }) => {
      if (pattern.test(code)) score += weight
    })

    // ===== Code Size Complexity =====
    if (lineCount > 500) score += 10
    else if (lineCount > 300) score += 6
    else if (lineCount > 150) score += 3

    // ===== Nesting Depth (deep nesting reduces readability) =====
    const maxNesting = this.calculateNestingDepth(code)
    score += Math.max(0, (maxNesting - 3)) * 2 // Over 3 levels, +2 per level

    // ===== Context and Global State =====
    score += count(/useContext/g) * 3
    score += count(/useStore|useAppStore/g) * 4
    score += count(/zustand|redux/g) * 3

    return Math.min(score, 100) // Max 100 points
  }

  /**
   * Calculate maximum nesting depth
   */
  calculateNestingDepth(code) {
    let maxDepth = 0
    let currentDepth = 0
    let inString = false
    let stringChar = ''
    let escapeNext = false
    let inSingleLineComment = false
    let inMultiLineComment = false

    for (let i = 0; i < code.length; i++) {
      const char = code[i]
      const nextChar = code[i + 1]

      if (inSingleLineComment) {
        if (char === '\n') inSingleLineComment = false
        continue
      }

      if (inMultiLineComment) {
        if (char === '*' && nextChar === '/') {
          inMultiLineComment = false
          i++
        }
        continue
      }

      if (inString) {
        if (escapeNext) {
          escapeNext = false
          continue
        }

        if (char === '\\') {
          escapeNext = true
          continue
        }

        if (char === stringChar) {
          inString = false
          stringChar = ''
        }
        continue
      }

      if (char === '/' && nextChar === '/') {
        inSingleLineComment = true
        i++
        continue
      }

      if (char === '/' && nextChar === '*') {
        inMultiLineComment = true
        i++
        continue
      }

      if (char === '"' || char === '\'' || char === '`') {
        inString = true
        stringChar = char
        continue
      }

      if (char === '{') {
        currentDepth++
        maxDepth = Math.max(maxDepth, currentDepth)
        continue
      }

      if (char === '}') {
        currentDepth = Math.max(currentDepth - 1, 0)
      }
    }

    return maxDepth
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

      if (!searchName) return 0

      const searchRoots = this.collectSearchRoots(resolvedComponentPath)
      if (searchRoots.length === 0) return 0

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
        if (!currentDir || visited.has(currentDir)) continue
        visited.add(currentDir)

        const entries = fs.readdirSync(currentDir, { withFileTypes: true })

        entries.forEach(entry => {
          const entryPath = path.join(currentDir, entry.name)

          if (entry.isDirectory()) {
            if (this.shouldSkipDir(entry.name)) return
            stack.push(entryPath)
            return
          }

          if (!this.shouldInspectFile(entry.name)) return

          const normalizedEntryPath = path.resolve(entryPath)
          if (normalizedEntryPath === path.resolve(resolvedComponentPath)) return

          const source = fs.readFileSync(entryPath, 'utf-8')
          if (!source.includes(searchName)) return

          if (patterns.some(pattern => {
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

      if (currentDir === workspaceRoot) break
      currentDir = path.dirname(currentDir)
    }

    const fallbackRoots = [
      path.join(workspaceRoot, 'app'),
      path.join(workspaceRoot, 'web', 'app'),
      path.join(workspaceRoot, 'src'),
    ]

    fallbackRoots.forEach(root => {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) roots.add(root)
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
    if (!(/\.(ts|tsx)$/i.test(fileName))) return false
    if (normalized.endsWith('.d.ts')) return false
    if (/\.(spec|test)\.(ts|tsx)$/.test(normalized)) return false
    if (normalized.endsWith('.stories.tsx')) return false
    return true
  }

  countMatches(code, pattern) {
    const matches = code.match(pattern)
    return matches ? matches.length : 0
  }

  static escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Calculate test priority based on complexity and usage
   *
   * Priority Score = Complexity Score + Usage Score
   * - Complexity: 0-100
   * - Usage: 0-50
   * - Total: 0-150
   *
   * Priority Levels:
   * - 0-30: Low
   * - 31-70: Medium
   * - 71-100: High
   * - 100+: Critical
   */
  calculateTestPriority(complexity, usageCount) {
    const complexityScore = complexity

    // Usage score calculation
    let usageScore
    if (usageCount === 0)
      usageScore = 0
    else if (usageCount <= 5)
      usageScore = 10
    else if (usageCount <= 20)
      usageScore = 20
    else if (usageCount <= 50)
      usageScore = 35
    else
      usageScore = 50

    const totalScore = complexityScore + usageScore

    return {
      score: totalScore,
      level: this.getPriorityLevel(totalScore),
      usageScore,
      complexityScore,
    }
  }

  /**
   * Get priority level based on score
   */
  getPriorityLevel(score) {
    if (score > 100) return '🔴 CRITICAL'
    if (score > 70) return '🟠 HIGH'
    if (score > 30) return '🟡 MEDIUM'
    return '🟢 LOW'
  }
}

// ============================================================================
// Prompt Builder for AI Assistants
// ============================================================================

class TestPromptBuilder {
  build(analysis, _sourceCode) {
    const testPath = analysis.path.replace(/\.tsx?$/, '.spec.tsx')

    return `
╔════════════════════════════════════════════════════════════════════════════╗
║                 📋 GENERATE TEST FOR DIFY COMPONENT                         ║
╚════════════════════════════════════════════════════════════════════════════╝

📍 Component: ${analysis.name}
📂 Path: ${analysis.path}
🎯 Test File: ${testPath}

📊 Component Analysis:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Type:          ${analysis.type}
Complexity:    ${analysis.complexity} ${this.getComplexityLevel(analysis.complexity)}
Lines:         ${analysis.lineCount}
Usage:         ${analysis.usageCount} reference${analysis.usageCount !== 1 ? 's' : ''}
Test Priority: ${analysis.priority.score} ${analysis.priority.level}

Features Detected:
  ${analysis.hasProps ? '✓' : '✗'} Props/TypeScript interfaces
  ${analysis.hasState ? '✓' : '✗'} Local state (useState)
  ${analysis.hasEffects ? '✓' : '✗'} Side effects (useEffect)
  ${analysis.hasCallbacks ? '✓' : '✗'} Callbacks (useCallback)
  ${analysis.hasMemo ? '✓' : '✗'} Memoization (useMemo)
  ${analysis.hasEvents ? '✓' : '✗'} Event handlers
  ${analysis.hasRouter ? '✓' : '✗'} Next.js routing
  ${analysis.hasAPI ? '✓' : '✗'} API calls
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please generate a comprehensive test file for this component at:
  ${testPath}

The component is located at:
  ${analysis.path}

${this.getSpecificGuidelines(analysis)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 PROMPT FOR AI ASSISTANT (COPY THIS TO YOUR AI ASSISTANT):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate a comprehensive test file for @${analysis.path}

Including but not limited to:
${this.buildFocusPoints(analysis)}

Create the test file at: ${testPath}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
  }

  getComplexityLevel(score) {
    if (score < 10) return '🟢 Simple'
    if (score < 30) return '🟡 Medium'
    return '🔴 Complex'
  }

  buildFocusPoints(analysis) {
    const points = []

    if (analysis.hasState) points.push('- Testing state management and updates')
    if (analysis.hasEffects) points.push('- Testing side effects and cleanup')
    if (analysis.hasCallbacks) points.push('- Testing callback stability and memoization')
    if (analysis.hasMemo) points.push('- Testing memoization logic and dependencies')
    if (analysis.hasEvents) points.push('- Testing user interactions and event handlers')
    if (analysis.hasRouter) points.push('- Mocking Next.js router hooks')
    if (analysis.hasAPI) points.push('- Mocking API calls')
    points.push('- Testing edge cases and error handling')
    points.push('- Testing all prop variations')

    return points.join('\n')
  }

  getSpecificGuidelines(analysis) {
    const guidelines = []

    // ===== Test Priority Guidance =====
    if (analysis.priority.level.includes('CRITICAL')) {
      guidelines.push('🔴 CRITICAL PRIORITY component:')
      guidelines.push(`   - Used in ${analysis.usageCount} places across the codebase`)
      guidelines.push('   - Changes will have WIDE impact')
      guidelines.push('   - Require comprehensive test coverage')
      guidelines.push('   - Add regression tests for all use cases')
      guidelines.push('   - Consider integration tests with dependent components')
    }
    else if (analysis.usageCount > 50) {
      guidelines.push('🟠 VERY HIGH USAGE component:')
      guidelines.push(`   - Referenced ${analysis.usageCount} times in the codebase`)
      guidelines.push('   - Changes may affect many parts of the application')
      guidelines.push('   - Comprehensive test coverage is CRITICAL')
      guidelines.push('   - Add tests for all common usage patterns')
      guidelines.push('   - Consider regression tests')
    }
    else if (analysis.usageCount > 20) {
      guidelines.push('🟡 HIGH USAGE component:')
      guidelines.push(`   - Referenced ${analysis.usageCount} times in the codebase`)
      guidelines.push('   - Test coverage is important to prevent widespread bugs')
      guidelines.push('   - Add tests for common usage patterns')
    }

    // ===== Complexity Warning =====
    if (analysis.complexity > 50) {
      guidelines.push('🔴 VERY COMPLEX component detected. Consider:')
      guidelines.push('   - Splitting component into smaller pieces before testing')
      guidelines.push('   - Creating integration tests for complex workflows')
      guidelines.push('   - Using test.each() for data-driven tests')
      guidelines.push('   - Adding performance benchmarks')
    }
    else if (analysis.complexity > 30) {
      guidelines.push('⚠️  This is a COMPLEX component. Consider:')
      guidelines.push('   - Breaking tests into multiple describe blocks')
      guidelines.push('   - Testing integration scenarios')
      guidelines.push('   - Grouping related test cases')
    }

    // ===== State Management =====
    if (analysis.hasState && analysis.hasEffects) {
      guidelines.push('🔄 State + Effects detected:')
      guidelines.push('   - Test state initialization and updates')
      guidelines.push('   - Test useEffect dependencies array')
      guidelines.push('   - Test cleanup functions (return from useEffect)')
      guidelines.push('   - Use waitFor() for async state changes')
    }
    else if (analysis.hasState) {
      guidelines.push('📊 State management detected:')
      guidelines.push('   - Test initial state values')
      guidelines.push('   - Test all state transitions')
      guidelines.push('   - Test state reset/cleanup scenarios')
    }
    else if (analysis.hasEffects) {
      guidelines.push('⚡ Side effects detected:')
      guidelines.push('   - Test effect execution conditions')
      guidelines.push('   - Verify dependencies array correctness')
      guidelines.push('   - Test cleanup on unmount')
    }

    // ===== Performance Optimization =====
    if (analysis.hasCallbacks || analysis.hasMemo) {
      const features = []
      if (analysis.hasCallbacks) features.push('useCallback')
      if (analysis.hasMemo) features.push('useMemo')

      guidelines.push(`🚀 Performance optimization (${features.join(', ')}):`)
      guidelines.push('   - Verify callbacks maintain referential equality')
      guidelines.push('   - Test memoization dependencies')
      guidelines.push('   - Ensure expensive computations are cached')
    }

    // ===== API Calls =====
    if (analysis.hasAPI) {
      guidelines.push('🌐 API calls detected:')
      guidelines.push('   - Mock all API calls using jest.mock')
      guidelines.push('   - Test retry logic if applicable')
      guidelines.push('   - Verify error handling and user feedback')
    }

    // ===== Routing =====
    if (analysis.hasRouter) {
      guidelines.push('🔀 Next.js routing detected:')
      guidelines.push('   - Mock useRouter, usePathname, useSearchParams')
      guidelines.push('   - Test navigation behavior and parameters')
      guidelines.push('   - Test query string handling')
      guidelines.push('   - Verify route guards/redirects if any')
    }

    // ===== Event Handlers =====
    if (analysis.hasEvents) {
      guidelines.push('🎯 Event handlers detected:')
      guidelines.push('   - Test all onClick, onChange, onSubmit handlers')
      guidelines.push('   - Test keyboard events (Enter, Escape, etc.)')
      guidelines.push('   - Verify event.preventDefault() calls if needed')
      guidelines.push('   - Test event bubbling/propagation')
    }

    // ===== Domain-Specific Components =====
    if (analysis.path.includes('workflow')) {
      guidelines.push('⚙️  Workflow component:')
      guidelines.push('   - Test node configuration and validation')
      guidelines.push('   - Test data flow and variable passing')
      guidelines.push('   - Test edge connections and graph structure')
      guidelines.push('   - Verify error handling for invalid configs')
    }

    if (analysis.path.includes('dataset')) {
      guidelines.push('📚 Dataset component:')
      guidelines.push('   - Test file upload and validation')
      guidelines.push('   - Test pagination and data loading')
      guidelines.push('   - Test search and filtering')
      guidelines.push('   - Verify data format handling')
    }

    if (analysis.path.includes('app/configuration') || analysis.path.includes('config')) {
      guidelines.push('⚙️  Configuration component:')
      guidelines.push('   - Test form validation thoroughly')
      guidelines.push('   - Test save/reset functionality')
      guidelines.push('   - Test required vs optional fields')
      guidelines.push('   - Verify configuration persistence')
    }

    // ===== File Size Warning =====
    if (analysis.lineCount > 500) {
      guidelines.push('📏 Large component (500+ lines):')
      guidelines.push('   - Consider splitting into smaller components')
      guidelines.push('   - Test major sections separately')
      guidelines.push('   - Use helper functions to reduce test complexity')
    }

    return guidelines.length > 0 ? `\n${guidelines.join('\n')}\n` : ''
  }
}

class TestReviewPromptBuilder {
  build({ analysis, testPath, testCode, originalPromptSection }) {
    const trimmedTestCode = testCode.trim()
    const formattedOriginalPrompt = originalPromptSection
      ? originalPromptSection
          .split('\n')
          .map(line => (line.trim().length > 0 ? `  ${line}` : ''))
          .join('\n')
          .trimEnd()
      : '  (original generation prompt unavailable)'

    return `
╔════════════════════════════════════════════════════════════════════════════╗
║                 ✅ REVIEW TEST FOR DIFY COMPONENT                           ║
╚════════════════════════════════════════════════════════════════════════════╝

📍 Component: ${analysis.name}
📂 Component Path: ${analysis.path}
🧪 Test File: ${testPath}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 REVIEW TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 PROMPT FOR AI ASSISTANT (COPY THIS TO YOUR AI ASSISTANT):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are reviewing the frontend test coverage for @${analysis.path}.

Original generation requirements:
${formattedOriginalPrompt}

Test file under review:
${testPath}

Checklist (ensure every item is addressed in your review):
- Confirm the tests satisfy all requirements listed above and in web/testing/TESTING.md.
- Verify Arrange → Act → Assert structure, mocks, and cleanup follow project conventions.
- Ensure all detected component features (state, effects, routing, API, events, etc.) are exercised, including edge cases and error paths.
- Check coverage of prop variations, null/undefined inputs, and high-priority workflows implied by usage score.
- Validate mocks/stubs interact correctly with Next.js router, network calls, and async updates.
- Ensure naming, describe/it structure, and placement match repository standards.

Output format:
1. Start with a single word verdict: PASS or FAIL.
2. If FAIL, list each missing requirement or defect as a separate bullet with actionable fixes.
3. Highlight any optional improvements or refactors after mandatory issues.
4. Mention any additional tests or tooling steps (e.g., pnpm lint/test) the developer should run.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
  }
}

function extractCopyContent(prompt) {
  const marker = '📋 PROMPT FOR AI ASSISTANT'
  const markerIndex = prompt.indexOf(marker)
  if (markerIndex === -1) return ''

  const section = prompt.slice(markerIndex)
  const lines = section.split('\n')
  const firstDivider = lines.findIndex(line => line.includes('━━━━━━━━'))
  if (firstDivider === -1) return ''

  const startIdx = firstDivider + 1
  let endIdx = lines.length

  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i].includes('━━━━━━━━')) {
      endIdx = i
      break
    }
  }

  if (startIdx >= endIdx) return ''

  return lines.slice(startIdx, endIdx).join('\n').trim()
}

// ============================================================================
// Main Function
// ============================================================================

function main() {
  const rawArgs = process.argv.slice(2)

  let isReviewMode = false
  const args = []

  rawArgs.forEach(arg => {
    if (arg === '--review') {
      isReviewMode = true
      return
    }
    args.push(arg)
  })

  if (args.length === 0) {
    console.error(`
❌ Error: Component path is required

This tool analyzes your component and generates a prompt for AI assistants.
Copy the output and use it with:
  - Cursor (Cmd+L for Chat, Cmd+I for Composer)
  - GitHub Copilot Chat (Cmd+I)
  - Claude, ChatGPT, or any other AI coding tool

For complete testing guidelines, see: web/testing/testing.md
    `)
    process.exit(1)
  }

  const componentPath = args[0]
  const absolutePath = path.resolve(process.cwd(), componentPath)

  // Check if file exists
  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ Error: File not found: ${componentPath}`)
    process.exit(1)
  }

  // Read source code
  const sourceCode = fs.readFileSync(absolutePath, 'utf-8')

  // Analyze
  const analyzer = new ComponentAnalyzer()
  const analysis = analyzer.analyze(sourceCode, componentPath, absolutePath)

  // Check if component is too complex - suggest refactoring instead of testing
  if (!isReviewMode && (analysis.complexity > 50 || analysis.lineCount > 300)) {
    console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                     ⚠️  COMPONENT TOO COMPLEX TO TEST                       ║
╚════════════════════════════════════════════════════════════════════════════╝

📍 Component: ${analysis.name}
📂 Path: ${analysis.path}

📊 Component Metrics:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Complexity:    ${analysis.complexity} ${analysis.complexity > 50 ? '🔴 TOO HIGH' : '⚠️  WARNING'}
Lines:         ${analysis.lineCount} ${analysis.lineCount > 300 ? '🔴 TOO LARGE' : '⚠️  WARNING'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚫 RECOMMENDATION: REFACTOR BEFORE TESTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This component is too complex to test effectively. Please consider:

1️⃣  **Split into smaller components**
   - Extract reusable UI sections into separate components
   - Separate business logic from presentation
   - Create smaller, focused components (< 300 lines each)

2️⃣  **Extract custom hooks**
   - Move state management logic to custom hooks
   - Extract complex data transformation logic
   - Separate API calls into dedicated hooks

3️⃣  **Simplify logic**
   - Reduce nesting depth
   - Break down complex conditions
   - Extract helper functions

4️⃣  **After refactoring**
   - Run this tool again on each smaller component
   - Generate tests for the refactored components
   - Tests will be easier to write and maintain

💡 TIP: Aim for components with:
   - Complexity score < 30 (preferably < 20)
   - Line count < 300 (preferably < 200)
   - Single responsibility principle

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
    process.exit(0)
  }

  // Build prompt for AI assistant
  const builder = new TestPromptBuilder()
  const generationPrompt = builder.build(analysis, sourceCode)

  let prompt = generationPrompt

  if (isReviewMode) {
    const providedTestPath = args[1]
    const inferredTestPath = inferTestPath(componentPath)
    const testPath = providedTestPath ?? inferredTestPath
    const absoluteTestPath = path.resolve(process.cwd(), testPath)

    if (!fs.existsSync(absoluteTestPath)) {
      console.error(`❌ Error: Test file not found: ${testPath}`)
      process.exit(1)
    }

    const testCode = fs.readFileSync(absoluteTestPath, 'utf-8')
    const reviewBuilder = new TestReviewPromptBuilder()
    const originalPromptSection = extractCopyContent(generationPrompt)
    const normalizedTestPath = path.relative(process.cwd(), absoluteTestPath) || testPath

    prompt = reviewBuilder.build({
      analysis,
      testPath: normalizedTestPath,
      testCode,
      originalPromptSection,
    })
  }

  // Output
  console.log(prompt)

  try {
    const { spawnSync } = require('node:child_process')

    const checkPbcopy = spawnSync('which', ['pbcopy'], { stdio: 'pipe' })
    if (checkPbcopy.status !== 0) return
    const copyContent = extractCopyContent(prompt)
    if (!copyContent) return

    const result = spawnSync('pbcopy', [], {
      input: copyContent,
      encoding: 'utf-8',
    })

    if (result.status === 0) {
      console.log('\n📋 Prompt copied to clipboard!')
      console.log('   Paste it in your AI assistant:')
      console.log('   - Cursor: Cmd+L (Chat) or Cmd+I (Composer)')
      console.log('   - GitHub Copilot Chat: Cmd+I')
      console.log('   - Or any other AI coding tool\n')
    }
  }
  catch {
    // pbcopy failed, but don't break the script
  }
}

function inferTestPath(componentPath) {
  const ext = path.extname(componentPath)
  if (!ext) return `${componentPath}.spec.ts`
  return componentPath.replace(ext, `.spec${ext}`)
}

// ============================================================================
// Run
// ============================================================================

main()
