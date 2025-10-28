#!/usr/bin/env node
/**
 * Component Analyzer for Cursor AI
 *
 * Analyzes a component and generates a structured prompt for Cursor AI.
 * Copy the output and paste into Cursor Chat (Cmd+L) or Composer (Cmd+I).
 *
 * Usage:
 *   node scripts/analyze-component.js <component-path>
 *
 * Examples:
 *   node scripts/analyze-component.js app/components/base/button/index.tsx
 *   node scripts/analyze-component.js app/components/workflow/nodes/llm/panel.tsx
 */

const fs = require('node:fs')
const path = require('node:path')

// ============================================================================
// Simple Analyzer
// ============================================================================

class ComponentAnalyzer {
  analyze(code, filePath) {
    const fileName = path.basename(filePath, path.extname(filePath))
    const complexity = this.calculateComplexity(code)
    const lineCount = code.split('\n').length

    // Count usage references (may take a few seconds)
    const usageCount = this.countUsageReferences(filePath)

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
    if (filePath.includes('/hooks/')) return 'hook'
    if (filePath.includes('/utils/')) return 'util'
    if (filePath.includes('/page.tsx')) return 'page'
    if (code.includes('useState') || code.includes('useEffect')) return 'component'
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
  calculateComplexity(code) {
    let score = 0

    // ===== React Hooks (State Management Complexity) =====
    const stateHooks = (code.match(/useState/g) || []).length
    const effectHooks = (code.match(/useEffect/g) || []).length
    const callbackHooks = (code.match(/useCallback/g) || []).length
    const memoHooks = (code.match(/useMemo/g) || []).length
    const refHooks = (code.match(/useRef/g) || []).length
    const customHooks = (code.match(/use[A-Z]\w+/g) || []).length
                        - (stateHooks + effectHooks + callbackHooks + memoHooks + refHooks)

    score += stateHooks * 5 // Each state +5 (need to test state changes)
    score += effectHooks * 6 // Each effect +6 (need to test deps & cleanup)
    score += callbackHooks * 2 // Each callback +2
    score += memoHooks * 2 // Each memo +2
    score += refHooks * 1 // Each ref +1
    score += customHooks * 3 // Each custom hook +3

    // ===== Control Flow Complexity (Cyclomatic Complexity) =====
    score += (code.match(/if\s*\(/g) || []).length * 2 // if statement
    score += (code.match(/else\s+if/g) || []).length * 2 // else if
    score += (code.match(/\?\s*[^:]+\s*:/g) || []).length * 1 // ternary operator
    score += (code.match(/switch\s*\(/g) || []).length * 3 // switch
    score += (code.match(/case\s+/g) || []).length * 1 // case branch
    score += (code.match(/&&/g) || []).length * 1 // logical AND
    score += (code.match(/\|\|/g) || []).length * 1 // logical OR
    score += (code.match(/\?\?/g) || []).length * 1 // nullish coalescing

    // ===== Loop Complexity =====
    score += (code.match(/\.map\(/g) || []).length * 2 // map
    score += (code.match(/\.filter\(/g) || []).length * 1 // filter
    score += (code.match(/\.reduce\(/g) || []).length * 3 // reduce (complex)
    score += (code.match(/for\s*\(/g) || []).length * 2 // for loop
    score += (code.match(/while\s*\(/g) || []).length * 3 // while loop

    // ===== Props and Events Complexity =====
    const propsMatches = code.match(/(\w+)\s*:\s*\w+/g) || []
    const propsCount = Math.min(propsMatches.length, 20) // Max 20 props
    score += Math.floor(propsCount / 2) // Every 2 props +1

    const eventHandlers = (code.match(/on[A-Z]\w+/g) || []).length
    score += eventHandlers * 2 // Each event handler +2

    // ===== API Call Complexity =====
    score += (code.match(/fetch\(/g) || []).length * 4 // fetch
    score += (code.match(/axios\./g) || []).length * 4 // axios
    score += (code.match(/useSWR/g) || []).length * 4 // SWR
    score += (code.match(/useQuery/g) || []).length * 4 // React Query
    score += (code.match(/\.then\(/g) || []).length * 2 // Promise
    score += (code.match(/await\s+/g) || []).length * 2 // async/await

    // ===== Third-party Library Integration =====
    const hasReactFlow = /reactflow|ReactFlow/.test(code)
    const hasMonaco = /@monaco-editor/.test(code)
    const hasEcharts = /echarts/.test(code)
    const hasLexical = /lexical/.test(code)

    if (hasReactFlow) score += 15 // ReactFlow is very complex
    if (hasMonaco) score += 12 // Monaco Editor
    if (hasEcharts) score += 8 // Echarts
    if (hasLexical) score += 10 // Lexical Editor

    // ===== Code Size Complexity =====
    const lines = code.split('\n').length
    if (lines > 500) score += 10
    else if (lines > 300) score += 6
    else if (lines > 150) score += 3

    // ===== Nesting Depth (deep nesting reduces readability) =====
    const maxNesting = this.calculateNestingDepth(code)
    score += Math.max(0, (maxNesting - 3)) * 2 // Over 3 levels, +2 per level

    // ===== Context and Global State =====
    score += (code.match(/useContext/g) || []).length * 3
    score += (code.match(/useStore|useAppStore/g) || []).length * 4
    score += (code.match(/zustand|redux/g) || []).length * 3

    return Math.min(score, 100) // Max 100 points
  }

  /**
   * Calculate maximum nesting depth
   */
  calculateNestingDepth(code) {
    let maxDepth = 0
    let currentDepth = 0

    for (let i = 0; i < code.length; i++) {
      if (code[i] === '{') {
        currentDepth++
        maxDepth = Math.max(maxDepth, currentDepth)
      }
      else if (code[i] === '}') {
        currentDepth--
      }
    }

    return maxDepth
  }

  /**
   * Count how many times a component is referenced in the codebase
   * Uses grep for searching import statements
   */
  countUsageReferences(filePath) {
    try {
      const { execSync } = require('node:child_process')

      // Get component name from file path
      const fileName = path.basename(filePath, path.extname(filePath))

      // If the file is index.tsx, use the parent directory name as the component name
      // e.g., app/components/base/avatar/index.tsx -> search for 'avatar'
      // Otherwise use the file name
      // e.g., app/components/base/button.tsx -> search for 'button'
      let searchName = fileName
      if (fileName === 'index') {
        const parentDir = path.dirname(filePath)
        searchName = path.basename(parentDir)
      }

      // Build search pattern for import statements
      // Match: from '@/app/components/base/avatar'
      // Match: from './avatar'
      // Match: from '../avatar'
      // Simplified pattern to avoid shell quote issues
      const searchPattern = `/${searchName}'`

      // Use grep to search across all TypeScript files
      // -r: recursive
      // -l: list files with matches only
      // --include: only .ts and .tsx files
      // --exclude: exclude test and story files
      const grepCommand = `grep -rl --include="*.ts" --include="*.tsx" --exclude="*.spec.ts" --exclude="*.spec.tsx" --exclude="*.test.ts" --exclude="*.test.tsx" --exclude="*.stories.tsx" "${searchPattern}" app/ 2>/dev/null | wc -l`

      // eslint-disable-next-line sonarjs/os-command
      const result = execSync(grepCommand, {
        cwd: process.cwd(),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      })

      return Number.parseInt(result.trim(), 10) || 0
    }
    catch {
      // If command fails, return 0
      return 0
    }
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
// Prompt Builder for Cursor
// ============================================================================

class CursorPromptBuilder {
  build(analysis, _sourceCode) {
    const testPath = analysis.path.replace(/\.tsx?$/, '.spec.tsx')

    return `
╔════════════════════════════════════════════════════════════════════════════╗
║                  📋 GENERATE TEST FOR DIFY COMPONENT                        ║
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

📝 TASK FOR CURSOR AI:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please generate a comprehensive test file for this component at:
  ${testPath}

The component is located at:
  ${analysis.path}

Follow the testing guidelines in .cursorrules file.

${this.getSpecificGuidelines(analysis)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 COPY THIS TO CURSOR:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Generate a comprehensive test file for @${analysis.path} following the project's testing guidelines in .cursorrules.

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

// ============================================================================
// Main Function
// ============================================================================

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.error(`
❌ Error: Component path is required

Usage:
  node scripts/analyze-component.js <component-path>

Examples:
  node scripts/analyze-component.js app/components/base/button/index.tsx
  node scripts/analyze-component.js app/components/workflow/nodes/llm/panel.tsx

This tool analyzes your component and generates a prompt for Cursor AI.
Copy the output and use it in Cursor Chat (Cmd+L) or Composer (Cmd+I).
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
  const analysis = analyzer.analyze(sourceCode, componentPath)

  // Check if component is too complex - suggest refactoring instead of testing
  if (analysis.complexity > 50 || analysis.lineCount > 300) {
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

  // Build prompt for Cursor
  const builder = new CursorPromptBuilder()
  const prompt = builder.build(analysis, sourceCode)

  // Output
  console.log(prompt)

  try {
    const { spawnSync } = require('node:child_process')

    const checkPbcopy = spawnSync('which', ['pbcopy'], { stdio: 'pipe' })
    if (checkPbcopy.status !== 0) return
    const parts = prompt.split('📋 COPY THIS TO CURSOR:')
    if (parts.length < 2) return

    const afterMarker = parts[1]
    const lines = afterMarker.split('\n')

    const startIdx = lines.findIndex(line => line.includes('━━━')) + 1
    const endIdx = lines.findIndex((line, idx) => idx > startIdx && line.includes('━━━'))

    if (startIdx === 0 || endIdx === -1) return

    const copyContent = lines.slice(startIdx, endIdx).join('\n').trim()

    if (!copyContent) return

    const result = spawnSync('pbcopy', [], {
      input: copyContent,
      encoding: 'utf-8',
    })

    if (result.status === 0)
      console.log('\n📋 Prompt copied to clipboard! Paste it in Cursor Chat (Cmd+L).\n')
  }
  catch {
    // pbcopy failed, but don't break the script
  }
}

// ============================================================================
// Run
// ============================================================================

main()
