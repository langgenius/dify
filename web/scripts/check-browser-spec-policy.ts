import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, posix, relative, resolve } from 'node:path'
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

// Existing debt only. Entries are exact path/specifier/occurrence sites, never globs.
// Each W1 follow-up must delete the entries it fixes instead of broadening this list.
const MOCK_ALLOWLIST: MockAllowance[] = []

// Existing oversized suites only. Each W2 split must delete its exact entry.
const LINE_ALLOWLIST: LineAllowance[] = []

// Specs that need a navigation export `createTestNavigation` cannot provide.
const NAVIGATION_MOCK_ALLOWLIST: LineAllowance[] = [
  {
    path: 'app/components/provider/__tests__/i18n-hydration.browser.spec.tsx',
    reason: 'collects useServerInsertedHTML callbacks while server-rendering the same tree',
  },
]

export type PolicyViolation = {
  kind:
    | 'missing-boundary-comment'
    | 'oversized-spec'
    | 'service-mock'
    | 'raw-network-stub'
    | 'expected-failure-with-fake-api'
    | 'navigation-mock'
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
  observedNavigationAllowance: boolean
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

// API data must come from the contract-validated fake API (`@/test/fake-api`), not mocked clients.
// The web-relative module a specifier names, resolved against the spec's own (web-relative)
// path: `@/service/console` and `../../service/console` from `app/x/y/` both name `service/console`.
function resolveWebModule(specifier: string, specPath: string) {
  const target = specifier.startsWith('@/')
    ? specifier.slice(2)
    : specifier.startsWith('.')
      ? posix.normalize(posix.join(posix.dirname(specPath.replaceAll('\\', '/')), specifier))
      : undefined
  return target?.replace(/\.[cm]?[jt]sx?$/, '')
}

// `next/navigation` itself or the `@/next/navigation` re-export, from any spec location.
export function isNavigationMockSpecifier(specifier: string, specPath = '') {
  return (
    specifier === 'next/navigation' || resolveWebModule(specifier, specPath) === 'next/navigation'
  )
}

export function isServiceMockSpecifier(specifier: string, specPath = '') {
  const module = resolveWebModule(specifier, specPath)
  return module === 'service' || Boolean(module?.startsWith('service/'))
}

const networkGlobals = new Set(['fetch', 'XMLHttpRequest'])

function isGlobalObject(node: ts.Expression) {
  return ts.isIdentifier(node) && (node.text === 'globalThis' || node.text === 'window')
}

// `vi.stubGlobal('fetch', …)`, `vi.spyOn(globalThis, 'fetch')` or `globalThis.fetch = …`.
function rawNetworkStub(node: ts.Node) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    if (
      !ts.isPropertyAccessExpression(callee) ||
      !ts.isIdentifier(callee.expression) ||
      callee.expression.text !== 'vi'
    )
      return
    const [first, second] = node.arguments
    if (callee.name.text === 'stubGlobal' && first && ts.isStringLiteralLike(first))
      return networkGlobals.has(first.text) ? first.text : undefined
    if (
      callee.name.text === 'spyOn' &&
      first &&
      isGlobalObject(first) &&
      second &&
      ts.isStringLiteralLike(second)
    )
      return networkGlobals.has(second.text) ? second.text : undefined
    return
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    isGlobalObject(node.left.expression) &&
    networkGlobals.has(node.left.name.text)
  )
    return node.left.name.text
}

// `it.fails` also inverts the fake API's teardown failures, hiding contract violations.
// Resolve each import against the spec (web-relative `path`), so `@/test/fake-api`, `../fake-api`
// and the new-rag source helpers that install the fake are all recognized.
function usesFakeApi(sourceFile: ts.SourceFile, path: string) {
  return sourceFile.statements.some((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
      return false
    const module = resolveWebModule(statement.moduleSpecifier.text, path)
    return (
      module === 'test/fake-api' ||
      Boolean(module?.endsWith('/source-server')) ||
      Boolean(module?.endsWith('/source-browser-env'))
    )
  })
}

const testRegistrars = new Set(['it', 'test', 'describe'])

// `{ fails: true }` passed as test options, as in `it('…', { fails: true }, fn)`.
function hasFailsOption(node: ts.CallExpression) {
  return node.arguments.some(
    (argument) =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some(
        (property) =>
          (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
          ts.isIdentifier(property.name) &&
          property.name.text === 'fails' &&
          !(
            ts.isPropertyAssignment(property) &&
            property.initializer.kind === ts.SyntaxKind.FalseKeyword
          ),
      ),
  )
}

// Matches `it.fails(…)`, chained forms such as `it.fails.each([…])(…)`, the tagged-template
// `it.fails.each\`table\`(…)` and `test.concurrent.fails(…)`, and the `{ fails: true }` option.
function isExpectedFailure(node: ts.CallExpression) {
  // Report a chain once, at the call that registers the test.
  if (ts.isCallExpression(node.parent) && node.parent.expression === node) return false
  let current: ts.Expression = node.expression
  let fails = hasFailsOption(node)
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isCallExpression(current) ||
    ts.isTaggedTemplateExpression(current)
  ) {
    if (ts.isPropertyAccessExpression(current) && current.name.text === 'fails') fails = true
    current = ts.isTaggedTemplateExpression(current) ? current.tag : current.expression
  }
  return fails && ts.isIdentifier(current) && testRegistrars.has(current.text)
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
  if (!argument) return
  if (ts.isStringLiteralLike(argument)) return argument.text
  // The type-safe form `vi.mock(import('@/service/console'), …)`.
  if (
    ts.isCallExpression(argument) &&
    argument.expression.kind === ts.SyntaxKind.ImportKeyword &&
    argument.arguments[0] &&
    ts.isStringLiteralLike(argument.arguments[0])
  )
    return argument.arguments[0].text
}

export function analyzeBrowserSpec(
  path: string,
  source: string,
  options: {
    mockAllowlist?: MockAllowance[]
    lineAllowlist?: LineAllowance[]
    navigationMockAllowlist?: LineAllowance[]
    maxLines?: number
  } = {},
): SourceAnalysis {
  const navigationAllowed = (options.navigationMockAllowlist ?? []).some(
    (entry) => entry.path === path,
  )
  let observedNavigationAllowance = false
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
  const fakeApi = usesFakeApi(sourceFile, path)

  function visit(node: ts.Node) {
    const stubbed = rawNetworkStub(node)
    if (stubbed) {
      violations.push({
        kind: 'raw-network-stub',
        path,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        message: `stubs ${stubbed} directly; serve requests with installFakeApi/setupFakeApi from @/test/fake-api, or guardUnexpectedFetch when none are expected`,
      })
    }
    if (fakeApi && ts.isCallExpression(node) && isExpectedFailure(node)) {
      violations.push({
        kind: 'expected-failure-with-fake-api',
        path,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        message:
          'it.fails would also hide fake API contract failures; keep the test normal and assert only the known bug',
      })
    }
    if (ts.isCallExpression(node)) {
      const specifier = mockSpecifier(node)
      if (specifier && isServiceMockSpecifier(specifier, path)) {
        violations.push({
          kind: 'service-mock',
          path,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          specifier,
          message: `mocks ${specifier}; serve API data with installFakeApi/setupFakeApi from @/test/fake-api instead`,
        })
      }
      const navigationMock = Boolean(specifier && isNavigationMockSpecifier(specifier, path))
      if (specifier && navigationMock) {
        if (navigationAllowed) observedNavigationAllowance = true
        else {
          violations.push({
            kind: 'navigation-mock',
            path,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
            specifier,
            message: `mocks ${specifier}; render inside createTestNavigation's NavigationProvider from @/test/next-navigation instead`,
          })
        }
      }
      if (specifier && !navigationMock && isOwnedMockSpecifier(specifier)) {
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
    observedNavigationAllowance,
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
    navigationMockAllowlist?: LineAllowance[]
  } = {},
): PolicyCheckResult {
  const mockAllowlist = options.mockAllowlist ?? MOCK_ALLOWLIST
  const lineAllowlist = options.lineAllowlist ?? LINE_ALLOWLIST
  const navigationMockAllowlist = options.navigationMockAllowlist ?? NAVIGATION_MOCK_ALLOWLIST
  const observedMockAllowances = new Set<string>()
  const observedLineAllowances = new Set<string>()
  const observedNavigationAllowances = new Set<string>()
  const violations = browserSpecsIn(webRoot)
    .sort()
    .flatMap((absolutePath) => {
      const path = relative(webRoot, absolutePath)
      const analysis = analyzeBrowserSpec(path, readFileSync(absolutePath, 'utf8'), {
        mockAllowlist,
        lineAllowlist,
        navigationMockAllowlist,
      })
      analysis.observedMockAllowances.forEach((key) => observedMockAllowances.add(key))
      if (analysis.observedLineAllowance) observedLineAllowances.add(path)
      if (analysis.observedNavigationAllowance) observedNavigationAllowances.add(path)
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
    ...navigationMockAllowlist
      .filter((entry) => !observedNavigationAllowances.has(entry.path))
      .map((entry) => `stale navigation mock allowlist: ${entry.path}`),
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
