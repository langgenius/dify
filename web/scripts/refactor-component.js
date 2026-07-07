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
// Extended Analyzer for Refactoring
// ============================================================================

class RefactorAnalyzer extends ComponentAnalyzer {
  analyze(code, filePath, absolutePath) {
    // Get base analysis from parent class
    const baseAnalysis = super.analyze(code, filePath, absolutePath)

    // Add refactoring-specific metrics
    // Note: These counts use regex matching which may include import statements.
    // For most components this results in +1 over actual usage, which is acceptable
    // for heuristic analysis. For precise AST-based counting, consider using
    // @typescript-eslint/parser to traverse the AST.
    const stateCount = (code.match(/useState\s*[(<]/g) || []).length
    const effectCount = (code.match(/useEffect\s*\(/g) || []).length
    const callbackCount = (code.match(/useCallback\s*\(/g) || []).length
    const memoCount = (code.match(/useMemo\s*\(/g) || []).length
    const conditionalBlocks = this.countConditionalBlocks(code)
    const nestedTernaries = this.countNestedTernaries(code)
    const hasContext = code.includes('useContext') || code.includes('createContext')
    const hasReducer = code.includes('useReducer')
    const hasModals = this.countModals(code)

    return {
      ...baseAnalysis,
      stateCount,
      effectCount,
      callbackCount,
      memoCount,
      conditionalBlocks,
      nestedTernaries,
      hasContext,
      hasReducer,
      hasModals,
    }
  }

  countModals(code) {
    const modalPatterns = [
      /Modal/g,
      /Dialog/g,
      /Drawer/g,
      /Confirm/g,
      /showModal|setShowModal|isShown|isShowing/g,
    ]
    let count = 0
    modalPatterns.forEach((pattern) => {
      const matches = code.match(pattern)
      if (matches)
        count += matches.length
    })
    return Math.floor(count / 3) // Rough estimate of actual modals
  }

  countConditionalBlocks(code) {
    const ifBlocks = (code.match(/\bif\s*\(/g) || []).length
    const ternaries = (code.match(/\?.*:/g) || []).length
    const switchCases = (code.match(/\bswitch\s*\(/g) || []).length
    return ifBlocks + ternaries + switchCases
  }

  countNestedTernaries(code) {
    const nestedInTrueBranch = (code.match(/\?[^:?]*\?[^:]*:/g) || []).length
    const nestedInFalseBranch = (code.match(/\?[^:?]*:[^?]*\?[^:]*:/g) || []).length

    return nestedInTrueBranch + nestedInFalseBranch
  }
}

// ============================================================================
// Refactor Prompt Builder
// ============================================================================

class RefactorPromptBuilder {
  build(analysis) {
    const refactorActions = this.identifyRefactorActions(analysis)

    return `
╔════════════════════════════════════════════════════════════════════════════╗
║                 🔧 REFACTOR DIFY COMPONENT                                  ║
╚════════════════════════════════════════════════════════════════════════════╝

📍 Component: ${analysis.name}
📂 Path: ${analysis.path}

📊 Complexity Analysis:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Complexity:    ${analysis.complexity}/100 ${getComplexityLevel(analysis.complexity)}
Max Func Complexity: ${analysis.maxComplexity}/100 ${getComplexityLevel(analysis.maxComplexity)}
Lines:               ${analysis.lineCount} ${analysis.lineCount > 300 ? '⚠️ TOO LARGE' : ''}
Usage:               ${analysis.usageCount} reference${analysis.usageCount !== 1 ? 's' : ''}

📈 Code Metrics:
  useState calls:    ${analysis.stateCount}
  useEffect calls:   ${analysis.effectCount}
  useCallback calls: ${analysis.callbackCount}
  useMemo calls:     ${analysis.memoCount}
  Conditional blocks: ${analysis.conditionalBlocks}
  Nested ternaries:  ${analysis.nestedTernaries}
  Modal components:  ${analysis.hasModals}

🔍 Features Detected:
  ${analysis.hasState ? '✓' : '✗'} Local state (useState/useReducer)
  ${analysis.hasEffects ? '✓' : '✗'} Side effects (useEffect)
  ${analysis.hasCallbacks ? '✓' : '✗'} Callbacks (useCallback)
  ${analysis.hasMemo ? '✓' : '✗'} Memoization (useMemo)
  ${analysis.hasContext ? '✓' : '✗'} Context (useContext/createContext)
  ${analysis.hasEvents ? '✓' : '✗'} Event handlers
  ${analysis.hasRouter ? '✓' : '✗'} Next.js routing
  ${analysis.hasAPI ? '✓' : '✗'} API calls
  ${analysis.hasReactQuery ? '✓' : '✗'} React Query
  ${analysis.hasAhooks ? '✓' : '✗'} ahooks
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 RECOMMENDED REFACTORING ACTIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${refactorActions.map((action, i) => `${i + 1}. ${action}`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 PROMPT FOR AI ASSISTANT (COPY THIS TO YOUR AI ASSISTANT):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please refactor the component at @${analysis.path}

Component metrics:
- Complexity: ${analysis.complexity}/100 (target: < 50)
- Lines: ${analysis.lineCount} (target: < 300)
- useState: ${analysis.stateCount}, useEffect: ${analysis.effectCount}

Refactoring tasks:
${refactorActions.map(action => `- ${action}`).join('\n')}

Requirements:
${this.buildRequirements(analysis)}

Follow Dify project conventions:
- Place extracted hooks in \`hooks/\` subdirectory or as \`use-<feature>.ts\`
- Use React Query (\`@tanstack/react-query\`) for data fetching
- Follow existing patterns in \`web/service/use-*.ts\` for API hooks
- Keep each new file under 300 lines
- Maintain TypeScript strict typing

After refactoring, verify:
- \`pnpm lint:fix\` passes
- \`pnpm type-check\` passes
- Re-run \`pnpm refactor-component ${analysis.path}\` to confirm complexity < 50

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
  }

  identifyRefactorActions(analysis) {
    const actions = []

    // Priority 1: Extract hooks for complex state management
    if (analysis.stateCount >= 3 || (analysis.stateCount >= 2 && analysis.effectCount >= 2)) {
      actions.push(`🪝 EXTRACT CUSTOM HOOK: ${analysis.stateCount} useState + ${analysis.effectCount} useEffect detected. Extract related state and effects into a custom hook (e.g., \`use${analysis.name}State.ts\`)`)
    }

    // Priority 2: Extract API/data logic
    if (analysis.hasAPI)
      actions.push('🌐 EXTRACT DATA HOOK: Move API calls and data fetching logic into a dedicated hook using React Query')

    // Priority 3: Split large components
    if (analysis.lineCount > 300) {
      actions.push(`📦 SPLIT COMPONENT: ${analysis.lineCount} lines exceeds limit. Extract UI sections into sub-components`)
    }

    // Priority 4: Extract modal management
    if (analysis.hasModals >= 2) {
      actions.push(`🔲 EXTRACT MODAL MANAGEMENT: ${analysis.hasModals} modal-related patterns detected. Create a useModalState hook or separate modal components`)
    }

    // Priority 5: Simplify conditionals
    if (analysis.conditionalBlocks > 10 || analysis.nestedTernaries >= 2) {
      actions.push('🔀 SIMPLIFY CONDITIONALS: Use lookup tables, early returns, or extract complex conditions into named functions')
    }

    // Priority 6: Extract callbacks
    if (analysis.callbackCount >= 4) {
      actions.push(`⚡ CONSOLIDATE CALLBACKS: ${analysis.callbackCount} useCallback calls. Consider extracting related callbacks into a custom hook`)
    }

    // Priority 7: Context provider extraction
    if (analysis.hasContext && analysis.complexity > 50) {
      actions.push('🎯 EXTRACT CONTEXT LOGIC: Move context provider logic into separate files or split into domain-specific contexts')
    }

    // Priority 8: Memoization review
    if (analysis.memoCount >= 3 && analysis.complexity > 50) {
      actions.push(`📝 REVIEW MEMOIZATION: ${analysis.memoCount} useMemo calls. Extract complex computations into utility functions or hooks`)
    }

    // If no specific issues, provide general guidance
    if (actions.length === 0) {
      if (analysis.complexity > 50) {
        actions.push('🔍 ANALYZE FUNCTIONS: Review individual functions for complexity and extract helper functions')
      }
      else {
        actions.push('✅ Component complexity is acceptable. Consider minor improvements for maintainability')
      }
    }

    return actions
  }

  buildRequirements(analysis) {
    const requirements = []

    if (analysis.stateCount >= 3) {
      requirements.push('- Group related useState calls into a single custom hook')
      requirements.push('- Move associated useEffect calls with the state they depend on')
    }

    if (analysis.hasAPI) {
      requirements.push('- Create data fetching hook following web/service/use-*.ts patterns')
      requirements.push('- Use useQuery with proper queryKey and enabled options')
      requirements.push('- Export invalidation hook (useInvalidXxx) for cache management')
    }

    if (analysis.lineCount > 300) {
      requirements.push('- Extract logical UI sections into separate components')
      requirements.push('- Keep parent component focused on orchestration')
      requirements.push('- Pass minimal props to child components')
    }

    if (analysis.hasModals >= 2) {
      requirements.push('- Create unified modal state management')
      requirements.push('- Consider extracting modals to separate file')
    }

    if (analysis.conditionalBlocks > 10) {
      requirements.push('- Replace switch statements with lookup tables')
      requirements.push('- Use early returns to reduce nesting')
      requirements.push('- Extract complex boolean logic to named functions')
    }

    if (requirements.length === 0) {
      requirements.push('- Maintain existing code structure')
      requirements.push('- Focus on readability improvements')
    }

    return requirements.join('\n')
  }
}

// ============================================================================
// Main Function
// ============================================================================

function showHelp() {
  console.log(`
🔧 Component Refactor Tool - Generate refactoring prompts for AI assistants

Usage:
  node refactor-component.js <component-path> [options]
  pnpm refactor-component <component-path> [options]

Options:
  --help      Show this help message
  --json      Output analysis result as JSON (for programmatic use)

Examples:
  # Analyze and generate refactoring prompt
  pnpm refactor-component app/components/app/configuration/index.tsx

  # Output as JSON
  pnpm refactor-component app/components/tools/mcp/modal.tsx --json

Complexity Thresholds:
  🟢 0-25:   Simple (no refactoring needed)
  🟡 26-50:  Medium (consider minor refactoring)
  🟠 51-75:  Complex (should refactor)
  🔴 76-100: Very Complex (must refactor)

For complete refactoring guidelines, see:
  .claude/skills/component-refactoring/SKILL.md
`)
}

function main() {
  const rawArgs = process.argv.slice(2)

  let isJsonMode = false
  const args = []

  rawArgs.forEach((arg) => {
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

  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ Error: Path not found: ${componentPath}`)
    process.exit(1)
  }

  if (fs.statSync(absolutePath).isDirectory()) {
    const resolvedFile = resolveDirectoryEntry(absolutePath, componentPath)
    if (resolvedFile) {
      absolutePath = resolvedFile.absolutePath
      componentPath = resolvedFile.componentPath
    }
    else {
      const availableFiles = listAnalyzableFiles(absolutePath)
      console.error(`❌ Error: Directory does not contain a recognizable entry file: ${componentPath}`)
      if (availableFiles.length > 0) {
        console.error(`\n   Available files to analyze:`)
        availableFiles.forEach(f => console.error(`   - ${path.join(componentPath, f)}`))
        console.error(`\n   Please specify the exact file path, e.g.:`)
        console.error(`   pnpm refactor-component ${path.join(componentPath, availableFiles[0])}`)
      }
      process.exit(1)
    }
  }

  const sourceCode = fs.readFileSync(absolutePath, 'utf-8')

  const analyzer = new RefactorAnalyzer()
  const analysis = analyzer.analyze(sourceCode, componentPath, absolutePath)

  // JSON output mode
  if (isJsonMode) {
    console.log(JSON.stringify(analysis, null, 2))
    return
  }

  // Check if refactoring is needed
  if (analysis.complexity <= 25 && analysis.lineCount <= 200) {
    console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║                 ✅ COMPONENT IS WELL-STRUCTURED                             ║
╚════════════════════════════════════════════════════════════════════════════╝

📍 Component: ${analysis.name}
📂 Path: ${analysis.path}

📊 Metrics:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Complexity: ${analysis.complexity}/100 🟢 Simple
Lines: ${analysis.lineCount} ✓ Within limits
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This component has good structure. No immediate refactoring needed.
You can proceed with testing using: pnpm analyze-component ${componentPath}
`)
    return
  }

  // Build refactoring prompt
  const builder = new RefactorPromptBuilder()
  const prompt = builder.build(analysis)

  console.log(prompt)

  // Copy to clipboard (macOS)
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
      console.log('\n📋 Refactoring prompt copied to clipboard!')
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

// ============================================================================
// Run
// ============================================================================

main()
