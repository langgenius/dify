#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  ComponentAnalyzer,
  extractCopyContent,
  getComplexityLevel,
  listAnalyzableFiles,
  resolveDirectoryEntry,
} from './component-analyzer.js'

// ============================================================================
// Prompt Builder for AI Assistants
// ============================================================================

class TestPromptBuilder {
  build(analysis) {
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
Type:               ${analysis.type}
Total Complexity:   ${analysis.complexity}/100 ${getComplexityLevel(analysis.complexity)}
Max Func Complexity: ${analysis.maxComplexity}/100 ${getComplexityLevel(analysis.maxComplexity)}
Lines:              ${analysis.lineCount}
Usage:              ${analysis.usageCount} reference${analysis.usageCount !== 1 ? 's' : ''}
Test Priority: ${analysis.priority.score} ${analysis.priority.level}

Features Detected:
  ${analysis.hasProps ? '✓' : '✗'} Props/TypeScript interfaces
  ${analysis.hasState ? '✓' : '✗'} Local state (useState/useReducer)
  ${analysis.hasEffects ? '✓' : '✗'} Side effects (useEffect)
  ${analysis.hasCallbacks ? '✓' : '✗'} Callbacks (useCallback)
  ${analysis.hasMemo ? '✓' : '✗'} Memoization (useMemo)
  ${analysis.hasEvents ? '✓' : '✗'} Event handlers
  ${analysis.hasRouter ? '✓' : '✗'} Next.js routing
  ${analysis.hasAPI ? '✓' : '✗'} API calls
  ${analysis.hasReactQuery ? '✓' : '✗'} React Query
  ${analysis.hasAhooks ? '✓' : '✗'} ahooks
  ${analysis.hasForwardRef ? '✓' : '✗'} Ref forwarding (forwardRef)
  ${analysis.hasComponentMemo ? '✓' : '✗'} Component memoization (React.memo)
  ${analysis.hasImperativeHandle ? '✓' : '✗'} Imperative handle
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

Generate a comprehensive test file for all files in @${path.dirname(analysis.path)}

Including but not limited to:
${this.buildFocusPoints(analysis)}

Create the test file at: ${testPath}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
  }

  buildFocusPoints(analysis) {
    const points = []

    if (analysis.hasState)
      points.push('- Testing state management and updates')
    if (analysis.hasEffects)
      points.push('- Testing side effects and cleanup')
    if (analysis.hasCallbacks)
      points.push('- Testing callback stability and memoization')
    if (analysis.hasMemo)
      points.push('- Testing memoization logic and dependencies')
    if (analysis.hasEvents)
      points.push('- Testing user interactions and event handlers')
    if (analysis.hasRouter)
      points.push('- Mocking Next.js router hooks')
    if (analysis.hasAPI)
      points.push('- Mocking API calls')
    if (analysis.hasForwardRef)
      points.push('- Testing ref forwarding behavior')
    if (analysis.hasComponentMemo)
      points.push('- Testing component memoization')
    if (analysis.hasSuspense)
      points.push('- Testing Suspense boundaries and lazy loading')
    if (analysis.hasPortal)
      points.push('- Testing Portal rendering')
    if (analysis.hasImperativeHandle)
      points.push('- Testing imperative handle methods')
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
    if (analysis.complexity > 75) {
      guidelines.push(`🔴 HIGH Total Complexity (${analysis.complexity}/100). Consider:`)
      guidelines.push('   - Splitting component into smaller pieces before testing')
      guidelines.push('   - Creating integration tests for complex workflows')
      guidelines.push('   - Using test.each() for data-driven tests')
    }
    else if (analysis.complexity > 50) {
      guidelines.push(`⚠️  MODERATE Total Complexity (${analysis.complexity}/100). Consider:`)
      guidelines.push('   - Breaking tests into multiple describe blocks')
      guidelines.push('   - Testing integration scenarios')
      guidelines.push('   - Grouping related test cases')
    }

    // ===== Max Function Complexity Warning =====
    if (analysis.maxComplexity > 75) {
      guidelines.push(`🔴 HIGH Single Function Complexity (max: ${analysis.maxComplexity}/100). Consider:`)
      guidelines.push('   - Breaking down the complex function into smaller helpers')
      guidelines.push('   - Extracting logic into custom hooks or utility functions')
    }
    else if (analysis.maxComplexity > 50) {
      guidelines.push(`⚠️  MODERATE Single Function Complexity (max: ${analysis.maxComplexity}/100). Consider:`)
      guidelines.push('   - Simplifying conditional logic')
      guidelines.push('   - Using early returns to reduce nesting')
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
    if (analysis.hasCallbacks || analysis.hasMemo || analysis.hasComponentMemo) {
      const features = []
      if (analysis.hasCallbacks)
        features.push('useCallback')
      if (analysis.hasMemo)
        features.push('useMemo')
      if (analysis.hasComponentMemo)
        features.push('React.memo')

      guidelines.push(`🚀 Performance optimization (${features.join(', ')}):`)
      guidelines.push('   - Verify callbacks maintain referential equality')
      guidelines.push('   - Test memoization dependencies')
      guidelines.push('   - Ensure expensive computations are cached')
      if (analysis.hasComponentMemo) {
        guidelines.push('   - Test component re-render behavior with prop changes')
      }
    }

    // ===== Ref Forwarding =====
    if (analysis.hasForwardRef || analysis.hasImperativeHandle) {
      guidelines.push('🔗 Ref forwarding detected:')
      guidelines.push('   - Test ref attachment to DOM elements')
      if (analysis.hasImperativeHandle) {
        guidelines.push('   - Test all exposed imperative methods')
        guidelines.push('   - Verify method behavior with different ref types')
      }
    }

    // ===== Suspense and Lazy Loading =====
    if (analysis.hasSuspense) {
      guidelines.push('⏳ Suspense/Lazy loading detected:')
      guidelines.push('   - Test fallback UI during loading')
      guidelines.push('   - Test component behavior after lazy load completes')
      guidelines.push('   - Test error boundaries with failed loads')
    }

    // ===== Portal =====
    if (analysis.hasPortal) {
      guidelines.push('🚪 Portal rendering detected:')
      guidelines.push('   - Test content renders in portal target')
      guidelines.push('   - Test portal cleanup on unmount')
      guidelines.push('   - Verify event bubbling through portal')
    }

    // ===== API Calls =====
    if (analysis.hasAPI) {
      guidelines.push('🌐 API calls detected:')
      guidelines.push('   - Mock API calls/hooks (useQuery, useMutation, fetch, etc.)')
      guidelines.push('   - Test loading, success, and error states')
      guidelines.push('   - Focus on component behavior, not the data fetching lib')
    }

    // ===== ahooks =====
    if (analysis.hasAhooks) {
      guidelines.push('🪝 ahooks detected (mock only, no need to test the lib):')
      guidelines.push('   - Mock ahooks utilities (useBoolean, useRequest, etc.)')
      guidelines.push('   - Focus on testing how your component uses the hooks')
      guidelines.push('   - Use fake timers if debounce/throttle is involved')
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

// ============================================================================
// Main Function
// ============================================================================

function showHelp() {
  console.log(`
📋 Component Analyzer - Generate test prompts for AI assistants

Usage:
  node analyze-component.js <component-path> [options]
  pnpm analyze-component <component-path> [options]

Options:
  --help      Show this help message
  --json      Output analysis result as JSON (for programmatic use)
  --review    Generate a review prompt for existing test file

Examples:
  # Analyze a component and generate test prompt
  pnpm analyze-component app/components/base/button/index.tsx

  # Output as JSON
  pnpm analyze-component app/components/base/button/index.tsx --json

  # Review existing test
  pnpm analyze-component app/components/base/button/index.tsx --review

For complete testing guidelines, see: web/testing/testing.md
`)
}

function main() {
  const rawArgs = process.argv.slice(2)

  let isReviewMode = false
  let isJsonMode = false
  const args = []

  rawArgs.forEach((arg) => {
    if (arg === '--review') {
      isReviewMode = true
      return
    }
    if (arg === '--json') {
      isJsonMode = true
      return
    }
    if (arg === '--help' || arg === '-h') {
      showHelp()
      process.exit(0)
    }
    args.push(arg)
  })

  if (args.length === 0) {
    showHelp()
    process.exit(1)
  }

  let componentPath = args[0]
  let absolutePath = path.resolve(process.cwd(), componentPath)

  // Check if path exists
  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ Error: Path not found: ${componentPath}`)
    process.exit(1)
  }

  // If directory, try to find entry file
  if (fs.statSync(absolutePath).isDirectory()) {
    const resolvedFile = resolveDirectoryEntry(absolutePath, componentPath)
    if (resolvedFile) {
      absolutePath = resolvedFile.absolutePath
      componentPath = resolvedFile.componentPath
    }
    else {
      // List available files for user to choose
      const availableFiles = listAnalyzableFiles(absolutePath)
      console.error(`❌ Error: Directory does not contain a recognizable entry file: ${componentPath}`)
      if (availableFiles.length > 0) {
        console.error(`\n   Available files to analyze:`)
        availableFiles.forEach(f => console.error(`   - ${path.join(componentPath, f)}`))
        console.error(`\n   Please specify the exact file path, e.g.:`)
        console.error(`   pnpm analyze-component ${path.join(componentPath, availableFiles[0])}`)
      }
      process.exit(1)
    }
  }

  // Read source code
  const sourceCode = fs.readFileSync(absolutePath, 'utf-8')

  // Analyze
  const analyzer = new ComponentAnalyzer()
  const analysis = analyzer.analyze(sourceCode, componentPath, absolutePath)

  // Check if component is too complex - suggest refactoring instead of testing
  // Skip this check in JSON mode to always output analysis result
  if (!isReviewMode && !isJsonMode && (analysis.complexity > 75 || analysis.lineCount > 300)) {
    console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                     ⚠️  COMPONENT TOO COMPLEX TO TEST                       ║
╚════════════════════════════════════════════════════════════════════════════╝

📍 Component: ${analysis.name}
📂 Path: ${analysis.path}

📊 Component Metrics:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Complexity:     ${analysis.complexity}/100 ${analysis.complexity > 75 ? '🔴 TOO HIGH' : analysis.complexity > 50 ? '⚠️  WARNING' : '🟢 OK'}
Max Func Complexity:  ${analysis.maxComplexity}/100 ${analysis.maxComplexity > 75 ? '🔴 TOO HIGH' : analysis.maxComplexity > 50 ? '⚠️  WARNING' : '🟢 OK'}
Lines:                ${analysis.lineCount} ${analysis.lineCount > 300 ? '🔴 TOO LARGE' : '🟢 OK'}
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
   - Cognitive Complexity < 50/100 (preferably < 25/100)
   - Line count < 300 (preferably < 200)
   - Single responsibility principle

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)
    process.exit(0)
  }

  // Build prompt for AI assistant
  const builder = new TestPromptBuilder()
  const generationPrompt = builder.build(analysis)

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

  // JSON output mode
  if (isJsonMode) {
    console.log(JSON.stringify(analysis, null, 2))
    return
  }

  // Output
  console.log(prompt)

  try {
    const checkPbcopy = spawnSync('which', ['pbcopy'], { stdio: 'pipe' })
    if (checkPbcopy.status !== 0)
      return
    const copyContent = extractCopyContent(prompt)
    if (!copyContent)
      return

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
  if (!ext)
    return `${componentPath}.spec.ts`
  return componentPath.replace(ext, `.spec${ext}`)
}

// ============================================================================
// Run
// ============================================================================

main()
