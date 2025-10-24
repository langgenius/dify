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

const fs = require('fs');
const path = require('path');

// ============================================================================
// Simple Analyzer
// ============================================================================

class ComponentAnalyzer {
  analyze(code, filePath) {
    const fileName = path.basename(filePath, path.extname(filePath));

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
      hasI18n: code.includes('useTranslation') || code.includes('react-i18next'),
      hasRouter: code.includes('useRouter') || code.includes('usePathname'),
      hasAPI: code.includes('service/') || code.includes('fetch('),
      isClientComponent: code.includes("'use client'") || code.includes('"use client"'),
      complexity: this.calculateComplexity(code),
      lineCount: code.split('\n').length,
    };
  }

  detectType(filePath, code) {
    if (filePath.includes('/hooks/')) return 'hook';
    if (filePath.includes('/utils/')) return 'util';
    if (filePath.includes('/page.tsx')) return 'page';
    if (code.includes('useState') || code.includes('useEffect')) return 'component';
    return 'component';
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
    let score = 0;

    // ===== React Hooks (State Management Complexity) =====
    const stateHooks = (code.match(/useState/g) || []).length;
    const effectHooks = (code.match(/useEffect/g) || []).length;
    const callbackHooks = (code.match(/useCallback/g) || []).length;
    const memoHooks = (code.match(/useMemo/g) || []).length;
    const refHooks = (code.match(/useRef/g) || []).length;
    const customHooks = (code.match(/use[A-Z]\w+/g) || []).length -
                        (stateHooks + effectHooks + callbackHooks + memoHooks + refHooks);

    score += stateHooks * 5;        // Each state +5 (need to test state changes)
    score += effectHooks * 6;       // Each effect +6 (need to test deps & cleanup)
    score += callbackHooks * 2;     // Each callback +2
    score += memoHooks * 2;         // Each memo +2
    score += refHooks * 1;          // Each ref +1
    score += customHooks * 3;       // Each custom hook +3

    // ===== Control Flow Complexity (Cyclomatic Complexity) =====
    score += (code.match(/if\s*\(/g) || []).length * 2;           // if statement
    score += (code.match(/else\s+if/g) || []).length * 2;         // else if
    score += (code.match(/\?\s*[^:]+\s*:/g) || []).length * 1;    // ternary operator
    score += (code.match(/switch\s*\(/g) || []).length * 3;       // switch
    score += (code.match(/case\s+/g) || []).length * 1;           // case branch
    score += (code.match(/&&/g) || []).length * 1;                // logical AND
    score += (code.match(/\|\|/g) || []).length * 1;              // logical OR
    score += (code.match(/\?\?/g) || []).length * 1;              // nullish coalescing

    // ===== Loop Complexity =====
    score += (code.match(/\.map\(/g) || []).length * 2;           // map
    score += (code.match(/\.filter\(/g) || []).length * 1;        // filter
    score += (code.match(/\.reduce\(/g) || []).length * 3;        // reduce (complex)
    score += (code.match(/for\s*\(/g) || []).length * 2;          // for loop
    score += (code.match(/while\s*\(/g) || []).length * 3;        // while loop

    // ===== Props and Events Complexity =====
    const propsMatches = code.match(/(\w+)\s*:\s*\w+/g) || [];
    const propsCount = Math.min(propsMatches.length, 20); // Max 20 props
    score += Math.floor(propsCount / 2);                   // Every 2 props +1

    const eventHandlers = (code.match(/on[A-Z]\w+/g) || []).length;
    score += eventHandlers * 2;                            // Each event handler +2

    // ===== API Call Complexity =====
    score += (code.match(/fetch\(/g) || []).length * 4;           // fetch
    score += (code.match(/axios\./g) || []).length * 4;           // axios
    score += (code.match(/useSWR/g) || []).length * 4;            // SWR
    score += (code.match(/useQuery/g) || []).length * 4;          // React Query
    score += (code.match(/\.then\(/g) || []).length * 2;          // Promise
    score += (code.match(/await\s+/g) || []).length * 2;          // async/await

    // ===== Third-party Library Integration =====
    const hasReactFlow = /reactflow|ReactFlow/.test(code);
    const hasMonaco = /@monaco-editor/.test(code);
    const hasEcharts = /echarts/.test(code);
    const hasLexical = /lexical/.test(code);

    if (hasReactFlow) score += 15;  // ReactFlow is very complex
    if (hasMonaco) score += 12;     // Monaco Editor
    if (hasEcharts) score += 8;     // Echarts
    if (hasLexical) score += 10;    // Lexical Editor

    // ===== Code Size Complexity =====
    const lines = code.split('\n').length;
    if (lines > 500) score += 10;
    else if (lines > 300) score += 6;
    else if (lines > 150) score += 3;

    // ===== Nesting Depth (deep nesting reduces readability) =====
    const maxNesting = this.calculateNestingDepth(code);
    score += Math.max(0, (maxNesting - 3)) * 2;  // Over 3 levels, +2 per level

    // ===== Context and Global State =====
    score += (code.match(/useContext/g) || []).length * 3;
    score += (code.match(/useStore|useAppStore/g) || []).length * 4;
    score += (code.match(/zustand|redux/g) || []).length * 3;

    return Math.min(score, 100);  // Max 100 points
  }

  /**
   * Calculate maximum nesting depth
   */
  calculateNestingDepth(code) {
    let maxDepth = 0;
    let currentDepth = 0;

    for (let i = 0; i < code.length; i++) {
      if (code[i] === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (code[i] === '}') {
        currentDepth--;
      }
    }

    return maxDepth;
  }
}

// ============================================================================
// Prompt Builder for Cursor
// ============================================================================

class CursorPromptBuilder {
  build(analysis, sourceCode) {
    const testPath = analysis.path.replace(/\.tsx?$/, '.spec.tsx');

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

Features Detected:
  ${analysis.hasProps ? '✓' : '✗'} Props/TypeScript interfaces
  ${analysis.hasState ? '✓' : '✗'} Local state (useState)
  ${analysis.hasEffects ? '✓' : '✗'} Side effects (useEffect)
  ${analysis.hasCallbacks ? '✓' : '✗'} Callbacks (useCallback)
  ${analysis.hasMemo ? '✓' : '✗'} Memoization (useMemo)
  ${analysis.hasEvents ? '✓' : '✗'} Event handlers
  ${analysis.hasI18n ? '✓' : '✗'} Internationalization
  ${analysis.hasRouter ? '✓' : '✗'} Next.js routing
  ${analysis.hasAPI ? '✓' : '✗'} API calls
  ${analysis.isClientComponent ? '✓' : '✗'} Client component
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

Focus on:
${this.buildFocusPoints(analysis)}

Create the test file at: ${testPath}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  getComplexityLevel(score) {
    if (score < 10) return '🟢 Simple';
    if (score < 30) return '🟡 Medium';
    return '🔴 Complex';
  }

  buildFocusPoints(analysis) {
    const points = [];

    if (analysis.hasProps) points.push('- Testing all prop variations');
    if (analysis.hasState) points.push('- Testing state management and updates');
    if (analysis.hasEffects) points.push('- Testing side effects and cleanup');
    if (analysis.hasEvents) points.push('- Testing user interactions and event handlers');
    if (analysis.hasI18n) points.push('- Mocking i18n (useTranslation)');
    if (analysis.hasRouter) points.push('- Mocking Next.js router hooks');
    if (analysis.hasAPI) points.push('- Mocking API calls');

    points.push('- Testing accessibility (ARIA attributes)');
    points.push('- Testing edge cases and error handling');

    return points.join('\n');
  }

  getSpecificGuidelines(analysis) {
    const guidelines = [];

    if (analysis.complexity > 30) {
      guidelines.push('⚠️  This is a COMPLEX component. Consider:');
      guidelines.push('   - Breaking tests into multiple describe blocks');
      guidelines.push('   - Testing integration scenarios');
      guidelines.push('   - Adding performance tests');
    }

    if (analysis.hasAPI) {
      guidelines.push('🌐 This component makes API calls:');
      guidelines.push('   - Mock all API calls using jest.mock');
      guidelines.push('   - Test loading, success, and error states');
      guidelines.push('   - Test retry logic if applicable');
    }

    if (analysis.hasRouter) {
      guidelines.push('🔀 This component uses routing:');
      guidelines.push('   - Mock useRouter, usePathname, useSearchParams');
      guidelines.push('   - Test navigation behavior');
      guidelines.push('   - Test URL parameter handling');
    }

    if (analysis.path.includes('workflow')) {
      guidelines.push('⚙️  This is a Workflow component:');
      guidelines.push('   - Test node configuration');
      guidelines.push('   - Test data validation');
      guidelines.push('   - Test variable passing');
    }

    return guidelines.length > 0 ? '\n' + guidelines.join('\n') + '\n' : '';
  }
}

// ============================================================================
// Main Function
// ============================================================================

function main() {
  const args = process.argv.slice(2);

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
    `);
    process.exit(1);
  }

  const componentPath = args[0];
  const absolutePath = path.resolve(process.cwd(), componentPath);

  // Check if file exists
  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ Error: File not found: ${componentPath}`);
    process.exit(1);
  }

  // Read source code
  const sourceCode = fs.readFileSync(absolutePath, 'utf-8');

  // Analyze
  const analyzer = new ComponentAnalyzer();
  const analysis = analyzer.analyze(sourceCode, componentPath);

  // Build prompt for Cursor
  const builder = new CursorPromptBuilder();
  const prompt = builder.build(analysis, sourceCode);

  // Output
  console.log(prompt);

  // Also save to clipboard if pbcopy is available (macOS)
  try {
    const { execSync } = require('child_process');
    execSync('which pbcopy', { stdio: 'ignore' });

    // Save prompt to clipboard
    execSync('pbcopy', { input: prompt.split('📋 COPY THIS TO CURSOR:')[1].split('━━━')[0].trim() });
    console.log('\n📋 Prompt copied to clipboard! Paste it in Cursor Chat (Cmd+L).\n');
  } catch {
    // pbcopy not available, skip
  }
}

// ============================================================================
// Run
// ============================================================================

main();

