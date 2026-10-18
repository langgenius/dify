// Usage: node audit.cjs ROOT OUTPUT.json [SCOPE ...]
// Static call-site inventory, not a count of runtime mocks or confirmed violations.
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const { createRequire } = require('node:module')
const crypto = require('node:crypto')
if (process.argv.includes('--help')) {
  console.log(
    'Usage: node audit.cjs ROOT OUTPUT.json [SCOPE ...]\nDefault scope: web. Scopes are repository-relative directories or explicit JS/TS helper files.',
  )
  process.exit(0)
}
if (!process.argv[2] || !process.argv[3])
  throw new Error('ROOT and OUTPUT.json are required; see --help')
const root = fs.realpathSync(path.resolve(process.argv[2]))
const output = path.resolve(process.argv[3])
const requestedScopes = process.argv.slice(4).length ? process.argv.slice(4) : ['web']
const scopes = [
  ...new Set(
    requestedScopes.map((input) => {
      const relative = path.relative(root, path.resolve(root, input)).split(path.sep).join('/')
      if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative))
        throw new Error(`Scope outside repository: ${input}`)
      return relative || '.'
    }),
  ),
].sort()
const git = (...args) =>
  cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
if (fs.realpathSync(git('rev-parse', '--show-toplevel').trim()) !== root)
  throw new Error('ROOT must be the Git repository root')
let ts
for (const dir of [
  root,
  ...scopes.map((scope) => path.join(root, scope)),
  path.join(root, 'web'),
]) {
  try {
    ts = createRequire(path.join(dir, 'package.json'))('typescript')
    break
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error
  }
}
if (!ts)
  throw new Error(
    'TypeScript is unavailable; install repository dependencies using its documented workflow',
  )
const tracked = [
  ...new Set(
    git('ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', ...scopes)
      .split('\0')
      .filter(Boolean),
  ),
].sort()
const executable = /\.[cm]?[jt]sx?$/
const spec = /\.(spec|test)\.[cm]?[jt]sx?$/
const story = (f) => f.startsWith('packages/dify-ui/') && /\.stories\.[cm]?[jt]sx?$/.test(f)
const support =
  /(?:\/(?:__tests__|__mocks__|test|tests|test-utils)\/|(?:^|\/)vitest(?:\.browser)?\.setup\.[cm]?[jt]s$|^web\/plugins\/tsslint\/test-utils\.ts$)/
const files = tracked.filter(
  (f) =>
    fs.existsSync(path.join(root, f)) &&
    executable.test(f) &&
    !/\.d\.[cm]?ts$/.test(f) &&
    (spec.test(f) || story(f) || support.test(f) || scopes.includes(f)),
)
if (!files.length) throw new Error('No test/support files found in requested scopes')
if (files.some((file) => path.resolve(root, file) === output))
  throw new Error('Output would overwrite a scanned source file')
const findings = []
const inventory = []
function unwrap(n) {
  while (n && ts.isParenthesizedExpression(n)) n = n.expression
  return n
}
function assertion(n) {
  return n && (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n))
}
function name(n) {
  if (!n) return ''
  if (ts.isIdentifier(n)) return n.text
  if (ts.isPropertyAccessExpression(n)) return `${name(n.expression)}.${n.name.text}`
  return ''
}
function containsClassRead(n) {
  if (!n) return false
  if (ts.isPropertyAccessExpression(n) && ['className', 'classList'].includes(n.name.text))
    return true
  if (
    ts.isCallExpression(n) &&
    ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === 'getAttribute' &&
    n.arguments[0] &&
    ts.isStringLiteralLike(n.arguments[0]) &&
    n.arguments[0].text === 'class'
  )
    return true
  return !!ts.forEachChild(n, containsClassRead)
}
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  if (sf.parseDiagnostics.length)
    throw new Error(
      `Cannot reliably parse ${file}: ${sf.parseDiagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('; ')}`,
    )
  const scope = story(file)
    ? 'storybook'
    : spec.test(file)
      ? /\.browser\.(?:spec|test)\./.test(file) || file.startsWith('packages/dify-ui/')
        ? 'browser'
        : 'unit'
      : 'support'
  inventory.push({
    file,
    scope,
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    lines: text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
  })
  const vitestNames = new Set(['vi', 'vitest'])
  const users = new Set()
  const userApis = new Set(['userEvent'])
  const renderApis = new Set(['render'])
  const renderResults = new Set()
  const renderRoots = new Set()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue
    const mod = stmt.moduleSpecifier.text
    const bindings = stmt.importClause.namedBindings
    if (mod === '@testing-library/user-event' && stmt.importClause.name)
      userApis.add(stmt.importClause.name.text)
    if (bindings && ts.isNamedImports(bindings))
      for (const el of bindings.elements) {
        const original = (el.propertyName || el.name).text
        if (/vitest|vite-plus\/test/.test(mod) && ['vi', 'vitest'].includes(original))
          vitestNames.add(el.name.text)
        if (original === 'userEvent') userApis.add(el.name.text)
        if (original === 'render') renderApis.add(el.name.text)
      }
  }
  function isRenderCall(node) {
    return node && ts.isCallExpression(node) && renderApis.has(name(node.expression))
  }
  function collectRenderBindings(node) {
    if (ts.isVariableDeclaration(node) && isRenderCall(unwrap(node.initializer))) {
      if (ts.isIdentifier(node.name)) renderResults.add(node.name.text)
      if (ts.isObjectBindingPattern(node.name)) {
        for (const binding of node.name.elements) {
          if (
            ts.isIdentifier(binding.name) &&
            ['container', 'baseElement'].includes(name(binding.propertyName || binding.name))
          )
            renderRoots.add(binding.name.text)
        }
      }
    }
    ts.forEachChild(node, collectRenderBindings)
  }
  collectRenderBindings(sf)
  function isRenderExistenceAssertion(expression) {
    // Inspect only expect's subject, not identifiers inside a larger business assertion.
    let receiver = expression.expression
    while (receiver && ts.isPropertyAccessExpression(receiver)) receiver = receiver.expression
    if (!receiver || !ts.isCallExpression(receiver) || name(receiver.expression) !== 'expect')
      return false
    const subject = unwrap(receiver.arguments[0])
    if (!subject) return false
    if (isRenderCall(subject)) return true
    if (ts.isIdentifier(subject))
      return renderRoots.has(subject.text) || renderResults.has(subject.text)
    return (
      ts.isPropertyAccessExpression(subject) &&
      ['container', 'baseElement'].includes(subject.name.text) &&
      (isRenderCall(subject.expression) ||
        (ts.isIdentifier(subject.expression) && renderResults.has(subject.expression.text)))
    )
  }
  function emit(metric, node, detail = '') {
    const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf))
    findings.push({ metric, file, scope, line: pos.line + 1, column: pos.character + 1, detail })
  }
  function insideHook(n, hook) {
    for (let p = n.parent; p; p = p.parent)
      if (ts.isCallExpression(p) && name(p.expression) === hook) return true
    return false
  }
  function visit(n) {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isCallExpression(n.initializer)
    ) {
      const call = name(n.initializer.expression)
      if ([...userApis].some((api) => call === `${api}.setup`)) users.add(n.name.text)
    }
    if (assertion(n)) {
      const type = n.type.getText(sf)
      if (type === 'const') emit('as_const', n)
      else emit('type_assertion_nodes', n, type)
      let parent = n.parent
      while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent
      if (!(assertion(parent) && unwrap(parent.expression) === n)) {
        const types = []
        let cursor = n
        while (assertion(cursor)) {
          types.push(cursor.type.getText(sf))
          cursor = unwrap(cursor.expression)
        }
        const risky =
          types.some((t) => t === 'any' || t === 'never') ||
          (types.length > 1 && types.includes('unknown'))
        if (risky) emit('unsafe_assertion_chains', n, types.slice().reverse().join(' -> '))
        if (types.includes('any')) emit('assertion_chains_any', n)
        if (types.includes('never')) emit('assertion_chains_never', n)
        if (types.length > 1 && types.includes('unknown'))
          emit('assertion_chains_unknown_bridge', n)
        if (types.length > 1)
          emit('double_assertion_chains', n, types.slice().reverse().join(' -> '))
      }
    }
    if (ts.isNonNullExpression(n)) emit('non_null_assertions', n)
    if (n.kind === ts.SyntaxKind.AnyKeyword) emit('any_type_nodes', n)
    if (ts.isCallExpression(n)) {
      const full = name(n.expression)
      const parts = full.split('.')
      const method = parts.at(-1)
      const receiver = parts.slice(0, -1).join('.')
      if (vitestNames.has(receiver)) {
        if (['mock', 'doMock', 'fn', 'spyOn', 'stubGlobal', 'stubEnv'].includes(method))
          emit(`vi_${method}`, n, n.arguments[0]?.getText(sf).slice(0, 200) || '')
        if (['mock', 'doMock'].includes(method)) {
          emit('module_mock', n)
          let target = n.arguments[0]
          if (
            target &&
            ts.isCallExpression(target) &&
            target.expression.kind === ts.SyntaxKind.ImportKeyword
          )
            target = target.arguments[0]
          if (target && ts.isStringLiteralLike(target)) {
            const t = target.text
            if (t.startsWith('@langgenius/dify-ui')) emit('mock_dify_ui', n, t)
            if (/^@\/(?:service|next)\//.test(t)) emit('mock_service_or_navigation', n, t)
            else if (/^@\/|^\./.test(t)) emit('mock_other_local', n, t)
            else emit('mock_external_package', n, t)
            if (/(?:^|\/)use-[^/]+|(?:^|\/)hooks?(?:\/|$)/.test(t)) emit('mock_hook_target', n, t)
            if (/(?:^|\/)(?:store|stores)(?:\/|$)/.test(t)) emit('mock_store_target', n, t)
            if (t === 'nuqs' || t.startsWith('nuqs/')) emit('mock_nuqs', n, t)
          } else emit('module_mock_dynamic_target', n)
        }
      }
      if (/^(?:get|query|find)(?:All)?ByTestId$/.test(method)) emit('testid_queries', n)
      if (/^(?:get|query|find)(?:All)?ByRole$/.test(method)) emit('role_queries', n)
      if (/^(?:get|query|find)(?:All)?ByLabelText$/.test(method)) emit('label_queries', n)
      if (parts[0] === 'fireEvent') emit('fireEvent_calls', n, full)
      if (['querySelector', 'querySelectorAll', 'getElementsByClassName'].includes(method))
        emit('css_dom_queries', n, n.arguments[0]?.getText(sf) || '')
      if (method === 'toHaveClass') emit('class_assertions', n)
      if (
        method === 'toHaveAttribute' &&
        n.arguments[0] &&
        ts.isStringLiteralLike(n.arguments[0]) &&
        n.arguments[0].text === 'class'
      )
        emit('class_assertions', n)
      if (['toMatchSnapshot', 'toMatchInlineSnapshot'].includes(method)) emit('snapshots', n)
      if (['toMatchImageSnapshot', 'toMatchScreenshot', 'toHaveScreenshot'].includes(method))
        emit('visual_snapshots', n)
      if (method === 'toBeDefined' || method === 'toBeTruthy') {
        if (isRenderExistenceAssertion(n.expression))
          emit('render_existence_assertion_candidate', n, n.expression.getText(sf).slice(0, 160))
      }
      if (
        ['it', 'test', 'describe'].includes(parts[0]) &&
        parts.some((p) => ['skip', 'todo', 'only', 'skipIf', 'runIf'].includes(p))
      )
        emit('test_execution_modifier', n, full)
      if (
        ['mockReset', 'mockClear', 'clearAllMocks', 'resetAllMocks'].includes(method) &&
        insideHook(n, 'afterEach')
      )
        emit('afterEach_mock_reset_candidate', n, full)
      if (['mockRestore', 'restoreAllMocks'].includes(method) && insideHook(n, 'afterEach'))
        emit('afterEach_mock_restore', n, full)
      if (userApis.has(receiver) && !['setup'].includes(method))
        emit('direct_userEvent_call', n, full)
      const isAsync =
        /^(?:find)(?:All)?By/.test(method) ||
        ['waitFor', 'waitForElementToBeRemoved'].includes(method) ||
        ((users.has(receiver) || userApis.has(receiver)) && method !== 'setup')
      if (isAsync && ts.isExpressionStatement(n.parent)) emit('bare_async_call_candidate', n, full)
      if (method === 'waitForTimeout' || ['sleep', 'delay'].includes(method))
        emit('fixed_wait_candidate', n, full)
      if (method === 'setTimeout' && insideNewPromise(n))
        emit('promise_timer_candidate', n, n.arguments[1]?.getText(sf) || '')
      if (scope === 'browser')
        for (const arg of n.arguments)
          if (ts.isObjectLiteralExpression(arg))
            for (const prop of arg.properties) {
              if (
                ts.isPropertyAssignment(prop) &&
                prop.name.getText(sf) === 'force' &&
                prop.initializer.kind === ts.SyntaxKind.TrueKeyword
              )
                emit('browser_force_true', n, full)
            }
      if (['toBe', 'toEqual', 'toStrictEqual', 'toContain', 'toMatch'].includes(method)) {
        if (containsClassRead(n.expression)) emit('class_assertions', n)
      }
    }
    ts.forEachChild(n, visit)
  }
  function insideNewPromise(n) {
    for (let p = n.parent; p; p = p.parent)
      if (ts.isNewExpression(p) && name(p.expression) === 'Promise') return true
    return false
  }
  visit(sf)
  // Use parser comment ranges rather than textual regex over fixture strings.
  const seenComments = new Set()
  function comments(n) {
    for (const range of [
      ...(ts.getLeadingCommentRanges(text, n.pos) || []),
      ...(ts.getTrailingCommentRanges(text, n.end) || []),
    ]) {
      if (seenComments.has(range.pos)) continue
      seenComments.add(range.pos)
      const raw = text.slice(range.pos, range.end)
      for (const directive of ['@ts-ignore', '@ts-expect-error', '@ts-nocheck'])
        if (raw.includes(directive)) {
          findings.push({
            metric: directive.slice(1).replaceAll('-', '_'),
            file,
            scope,
            line: sf.getLineAndCharacterOfPosition(range.pos).line + 1,
            column: 1,
            detail: raw.slice(0, 200),
          })
        }
    }
    ts.forEachChild(n, comments)
  }
  comments(sf)
}
const metrics = Object.fromEntries(
  [
    'mock_dify_ui',
    'mock_nuqs',
    'class_assertions',
    'snapshots',
    'visual_snapshots',
    'browser_force_true',
    'fixed_wait_candidate',
    'bare_async_call_candidate',
    'test_execution_modifier',
    'ts_ignore',
    'ts_nocheck',
    'module_mock_dynamic_target',
  ].map((k) => [k, {}]),
)
for (const f of findings) {
  const entry = (metrics[f.metric] ||= {})
  const row = (entry[f.scope] ||= { occurrences: 0, files: new Set() })
  row.occurrences++
  row.files.add(f.file)
}
for (const scopes of Object.values(metrics))
  for (const row of Object.values(scopes)) row.files = row.files.size
const policyPaths = []
if (inventory.some((entry) => entry.file.startsWith('web/'))) policyPaths.push('web/docs/test.md')
if (inventory.some((entry) => entry.file.startsWith('packages/dify-ui/')))
  policyPaths.push('packages/dify-ui/docs/testing.md')
const policies = policyPaths.map((file) => ({
  file,
  sha256: crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(root, file)))
    .digest('hex'),
}))
const report = {
  policies,
  version: 2,
  metricSchema: 'frontend-test-maintenance-v3',
  scannerSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  root,
  requestedScopes: scopes,
  workingTreeStatus: git('status', '--porcelain', '--', ...scopes),
  commit: git('rev-parse', 'HEAD').trim(),
  generatedAt: new Date().toISOString(),
  scopeDefinition:
    'Tracked and nonignored untracked JS/TS spec/test files in requested scopes; support in __tests__, __mocks__, test, tests, test-utils, Vitest setups and web/plugins/tsslint/test-utils.ts; explicit file scopes include custom helpers. Missing deleted files and declarations excluded. Web browser classification uses .browser.spec/test filename convention; Dify UI specs use browser and its stories use storybook. Recheck owner runner config if conventions change. Static syntax counts; runtime multiplicity and wrapper bodies not expanded.',
  limitations: [
    'Syntactic inventory, not a semantic audit or confirmed violation count.',
    'Arbitrary aliases, re-exports, wrapper functions and computed access may evade individual rules.',
    'Mock hook/store categories are path-name heuristics; relative paths are not resolved.',
    'Bare async rule checks standalone expression statements only, not all promise dataflow.',
    'Browser userEvent direct calls are expected; they must not be judged by the RTL setup rule.',
    'Ordinary assertions, non-null assertions and mocks require contract-specific review; category counts overlap.',
  ],
  inventory,
  metrics,
  findings,
}
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      commit: report.commit,
      scope: ['unit', 'browser', 'storybook', 'support'].map((scope) => ({
        scope,
        files: inventory.filter((x) => x.scope === scope).length,
        lines: inventory.filter((x) => x.scope === scope).reduce((a, x) => a + x.lines, 0),
      })),
      metrics,
    },
    null,
    2,
  ),
)
