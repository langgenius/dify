import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const MAX_BROWSER_SPEC_LINES = 500

type MockAllowance = {
  path: string
  specifier: string
  occurrence: number
  reason: string
}

type LineAllowance = {
  path: string
  reason: string
}

const legacyMockDebt = 'legacy owned-path mock; W1 must remove it or document the concrete boundary'

// Existing debt only. Entries are exact path/specifier/occurrence sites, never globs.
// Each W1 follow-up must delete the entries it fixes instead of broadening this list.
const MOCK_ALLOWLIST: MockAllowance[] = [
  {
    path: 'app/(auth)/signup/set-password/__tests__/page.browser.spec.tsx',
    specifier: '@/app/components/base/amplitude/registration-tracking',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/apps/__tests__/app-creation-url.browser.spec.tsx',
    specifier: 'react-i18next',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/base/agent-log-modal/__tests__/tool-call.browser.spec.tsx',
    specifier: '#i18n',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/datasets/list/dataset-card/components/__tests__/operations-menu.browser.spec.tsx',
    specifier: '@/features/tag-management/components/dataset-card-tags',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/datasets/list/dataset-card/components/__tests__/operations-menu.browser.spec.tsx',
    specifier: '@/context/permission-state',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/datasets/list/dataset-card/components/__tests__/operations-menu.browser.spec.tsx',
    specifier: '@/features/account-profile/client',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/datasets/list/dataset-card/components/__tests__/operations-menu.browser.spec.tsx',
    specifier: '@/features/system-features/client',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/datasets/settings/form/components/__tests__/reflow.browser.spec.tsx',
    specifier: 'react-i18next',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/header/account-setting/members-page/__tests__/delete-member.browser.spec.tsx',
    specifier: '@/features/contacts/management/feature-flag',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/workflow/__tests__/keyboard-node-movement.browser.spec.tsx',
    specifier: '../hooks/use-nodes-sync-draft',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/workflow/__tests__/keyboard-node-movement.browser.spec.tsx',
    specifier: '../hooks/use-workflow-history',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/workflow/__tests__/keyboard-node-movement.browser.spec.tsx',
    specifier: '../collaboration/core/collaboration-manager',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/workflow/nodes/human-input-v2/__tests__/recipients-keyboard.browser.spec.tsx',
    specifier: '@/app/components/workflow/nodes/_base/components/variable/var-reference-picker',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/workflow/nodes/human-input/components/__tests__/form-content.hitl-v2.browser.spec.tsx',
    specifier: '@/app/components/workflow/nodes/_base/hooks/use-node-crud',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/workflow/nodes/human-input/components/__tests__/form-content.hitl-v2.browser.spec.tsx',
    specifier: '@/app/components/workflow/hooks/use-workflow-variables',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/workflow/nodes/human-input/components/__tests__/form-content.hitl-v2.browser.spec.tsx',
    specifier: '@/app/components/workflow/hooks/use-workflow',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/workflow/nodes/human-input/components/__tests__/form-content.hitl-v2.browser.spec.tsx',
    specifier: '@/app/components/workflow/nodes/_base/hooks/use-available-var-list',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'app/components/workflow/nodes/human-input/components/__tests__/form-content.hitl-v2.browser.spec.tsx',
    specifier: '@/app/components/workflow/store',
    occurrence: 1,
    reason: legacyMockDebt,
  },
  {
    path: 'features/new-rag/documents/__tests__/delete-document.browser.spec.tsx',
    specifier: '../../components/knowledge-model-readiness-banner',
    occurrence: 1,
    reason: legacyMockDebt,
  },
]

// Existing oversized suites only. Each W2 split must delete its exact entry.
const LINE_ALLOWLIST: LineAllowance[] = []

export type PolicyViolation = {
  kind: 'missing-boundary-comment' | 'oversized-spec'
  path: string
  line?: number
  specifier?: string
  occurrence?: number
  message: string
}

type SourceAnalysis = {
  violations: PolicyViolation[]
  observedMockAllowances: Set<string>
  observedLineAllowance: boolean
}

const browserSpecPattern = /\.browser\.spec\.[cm]?[jt]sx?$/
const skippedDirectories = new Set(['.git', '.next', '.turbo', 'coverage', 'node_modules'])

function mockAllowanceKey(path: string, specifier: string, occurrence: number) {
  return `${path}\0${specifier}\0${occurrence}`
}

export function isOwnedMockSpecifier(specifier: string) {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    /^@\/(?:app|features|context|hooks)(?:\/|$)/.test(specifier) ||
    specifier.toLowerCase().includes('i18n') ||
    specifier === '#i18n' ||
    specifier.startsWith('#i18n/')
  )
}

function countLines(source: string) {
  if (!source) return 0
  const normalized = source.replaceAll('\r\n', '\n')
  const lines = normalized.split('\n').length
  return normalized.endsWith('\n') ? lines - 1 : lines
}

function hasBoundaryComment(lines: string[], callLine: number) {
  if (callLine === 0) return false
  return /^\s*\/\/\s*boundary:\s+\S/.test(lines[callLine - 1] ?? '')
}

function mockSpecifier(call: ts.CallExpression) {
  const expression = call.expression
  if (
    !ts.isPropertyAccessExpression(expression) ||
    !ts.isIdentifier(expression.expression) ||
    expression.expression.text !== 'vi' ||
    (expression.name.text !== 'mock' && expression.name.text !== 'doMock')
  )
    return

  const [argument] = call.arguments
  if (!argument || !ts.isStringLiteralLike(argument)) return
  return argument.text
}

export function analyzeBrowserSpec(
  path: string,
  source: string,
  options: {
    mockAllowlist?: MockAllowance[]
    lineAllowlist?: LineAllowance[]
    maxLines?: number
  } = {},
): SourceAnalysis {
  const mockAllowlist = options.mockAllowlist ?? []
  const lineAllowlist = options.lineAllowlist ?? []
  const maxLines = options.maxLines ?? MAX_BROWSER_SPEC_LINES
  const mockAllowanceKeys = new Set(
    mockAllowlist.map((entry) => mockAllowanceKey(entry.path, entry.specifier, entry.occurrence)),
  )
  const lineAllowed = lineAllowlist.some((entry) => entry.path === path)
  const observedMockAllowances = new Set<string>()
  const violations: PolicyViolation[] = []
  const lines = source.replaceAll('\r\n', '\n').split('\n')
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const occurrences = new Map<string, number>()

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const specifier = mockSpecifier(node)
      if (specifier && isOwnedMockSpecifier(specifier)) {
        const occurrence = (occurrences.get(specifier) ?? 0) + 1
        occurrences.set(specifier, occurrence)
        const key = mockAllowanceKey(path, specifier, occurrence)
        const callLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line
        if (!hasBoundaryComment(lines, callLine)) {
          if (mockAllowanceKeys.has(key)) observedMockAllowances.add(key)
          else {
            violations.push({
              kind: 'missing-boundary-comment',
              path,
              line: callLine + 1,
              specifier,
              occurrence,
              message: `${specifier} needs an immediately preceding // boundary: <reason> comment`,
            })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  const lineCount = countLines(source)
  if (lineCount > maxLines && !lineAllowed) {
    violations.push({
      kind: 'oversized-spec',
      path,
      message: `${lineCount} lines exceeds the ${maxLines}-line Browser spec limit`,
    })
  }

  return {
    violations,
    observedMockAllowances,
    observedLineAllowance: lineAllowed && lineCount > maxLines,
  }
}

function browserSpecsIn(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }) as Dirent[]
  return entries.flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return skippedDirectories.has(entry.name) ? [] : browserSpecsIn(path)
    return entry.isFile() && browserSpecPattern.test(entry.name) ? [path] : []
  })
}

export type PolicyCheckResult = {
  violations: PolicyViolation[]
  staleAllowances: string[]
}

export function checkBrowserSpecPolicy(
  webRoot: string,
  options: {
    mockAllowlist?: MockAllowance[]
    lineAllowlist?: LineAllowance[]
  } = {},
): PolicyCheckResult {
  const mockAllowlist = options.mockAllowlist ?? MOCK_ALLOWLIST
  const lineAllowlist = options.lineAllowlist ?? LINE_ALLOWLIST
  const observedMockAllowances = new Set<string>()
  const observedLineAllowances = new Set<string>()
  const violations = browserSpecsIn(webRoot)
    .sort()
    .flatMap((absolutePath) => {
      const path = relative(webRoot, absolutePath)
      const analysis = analyzeBrowserSpec(path, readFileSync(absolutePath, 'utf8'), {
        mockAllowlist,
        lineAllowlist,
      })
      analysis.observedMockAllowances.forEach((key) => observedMockAllowances.add(key))
      if (analysis.observedLineAllowance) observedLineAllowances.add(path)
      return analysis.violations
    })

  const staleAllowances = [
    ...mockAllowlist
      .filter(
        (entry) =>
          !observedMockAllowances.has(
            mockAllowanceKey(entry.path, entry.specifier, entry.occurrence),
          ),
      )
      .map(
        (entry) => `stale mock allowlist: ${entry.path} :: ${entry.specifier} #${entry.occurrence}`,
      ),
    ...lineAllowlist
      .filter((entry) => !observedLineAllowances.has(entry.path))
      .map((entry) => `stale line allowlist: ${entry.path}`),
  ]

  return { violations, staleAllowances }
}

export function reportPolicyResult({ violations, staleAllowances }: PolicyCheckResult) {
  if (!violations.length && !staleAllowances.length) {
    console.log('Browser spec policy passed.')
    return true
  }

  console.error('Browser spec policy failed:')
  violations.forEach((violation) => {
    const location = violation.line ? `${violation.path}:${violation.line}` : violation.path
    console.error(`- ${location}: ${violation.message}`)
  })
  staleAllowances.forEach((message) => console.error(`- ${message}`))
  process.exitCode = 1
  return false
}

export function runBrowserSpecPolicy() {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return reportPolicyResult(checkBrowserSpecPolicy(webRoot))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runBrowserSpecPolicy()
