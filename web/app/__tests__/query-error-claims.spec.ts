import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vite-plus/test'

/**
 * The query cache toasts a failed first load unless an owner that renders it claims it, through
 * `useOwnedQueryError`. This guard keeps every rendered query error on that path: whatever a
 * request error message, a describer or an `error` prop shows must not come from a query's error
 * directly, through the hooks that hand it on, or through local aliases. A mutation's error is
 * its own. `meta.errorOwner` no longer exists, so nothing may declare it.
 */

const webRoot = process.cwd()
const skippedDirectories = new Set([
  'node_modules',
  '.next',
  'dist',
  'public',
  'test',
  '__tests__',
  '__mocks__',
  'i18n',
  'docker',
  'bin',
])
const baseHooks = new Set(['useQuery', 'useInfiniteQuery'])
const errorReads = new Set(['error', 'isError', 'failureReason', 'isLoadingError'])
const ownedHooks = new Set(['useOwnedQueryError', 'useOwnedQueryErrors'])
// The error itself, or a field derived from it such as `loadError`; not a flag such as `isError`.
const errorAccess = /^(?:error|failureReason)$|^(?!is)[A-Za-z]*Error$/

type Site = {
  file: string
  line: number
  call: ts.CallExpression
  callee: string
  producer: string
  /** The wrapper hook this call sits in, when it hands its result or error on. */
  wrapper?: string
  kind: 'reads' | 'silent' | 'returns' | 'forwards' | 'passes' | 'unused'
}

function sourceFiles() {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name) && !entry.name.startsWith('.'))
          walk(path.join(dir, entry.name))
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(?:spec|test|stories)\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts')
      ) {
        files.push(path.join(dir, entry.name))
      }
    }
  }
  walk(webRoot)
  return files
}

const sources = new Map(
  sourceFiles().map((file) => [
    file,
    ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  ]),
)

function resolveModule(from: string, specifier: string) {
  let base: string
  if (specifier.startsWith('@/')) base = path.join(webRoot, specifier.slice(2))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier)
  else return undefined
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (sources.has(candidate)) return candidate
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

type Definition = { file: string; node: ts.Node }
const localDefinitions = new Map<string, Map<string, ts.Node>>()
const imports = new Map<string, Map<string, { module: string; name: string }>>()
const reexports = new Map<string, Map<string, { module: string; name: string }>>()
for (const [file, sf] of sources) {
  const defs = new Map<string, ts.Node>()
  const fileImports = new Map<string, { module: string; name: string }>()
  const fileReexports = new Map<string, { module: string; name: string }>()
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && !defs.has(node.name.text))
      defs.set(node.name.text, node)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !defs.has(node.name.text)
    )
      defs.set(node.name.text, node)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  for (const statement of sf.statements) {
    // `export default name` and `export default function name` are found as `default`.
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const target = ts.isIdentifier(statement.expression)
        ? defs.get(statement.expression.text)
        : statement.expression
      if (target) defs.set('default', target)
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    )
      defs.set('default', statement)
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.name
    ) {
      const module = resolveModule(file, statement.moduleSpecifier.text)
      if (module) fileImports.set(statement.importClause.name.text, { module, name: 'default' })
    }
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      const module = resolveModule(file, statement.moduleSpecifier.text)
      if (module) {
        for (const element of statement.importClause.namedBindings.elements)
          fileImports.set(element.name.text, {
            module,
            name: (element.propertyName ?? element.name).text,
          })
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const module = resolveModule(file, statement.moduleSpecifier.text)
      if (module) {
        for (const element of statement.exportClause.elements)
          fileReexports.set(element.name.text, {
            module,
            name: (element.propertyName ?? element.name).text,
          })
      }
    }
  }
  localDefinitions.set(file, defs)
  imports.set(file, fileImports)
  reexports.set(file, fileReexports)
}

function exportedDefinition(file: string, name: string, depth = 0): Definition | undefined {
  const node = localDefinitions.get(file)?.get(name)
  if (node) return { file, node }
  const next = reexports.get(file)?.get(name) ?? imports.get(file)?.get(name)
  if (next && depth < 4) return exportedDefinition(next.module, next.name, depth + 1)
  return undefined
}

/** The definition an identifier in `file` refers to, through its imports. */
function definitionOf(file: string, name: string) {
  const local = localDefinitions.get(file)?.get(name)
  if (local) return { file, node: local }
  const imported = imports.get(file)?.get(name)
  return imported ? exportedDefinition(imported.module, imported.name) : undefined
}

const keyOf = (definition: Definition) => `${definition.file}#${definition.node.pos}`

function unwrap(node: ts.Node) {
  let current = node
  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent) ||
      ts.isNonNullExpression(current.parent))
  )
    current = current.parent
  return current
}

// One of the values an expression evaluates to: a branch of `a ? b : c`, or a side of `a ?? b`
// and `a || b`, such as `return isDataset ? datasetQuery : targetQuery`.
function isBranchOf(parent: ts.Node, node: ts.Node) {
  if (ts.isConditionalExpression(parent))
    return parent.whenTrue === node || parent.whenFalse === node
  return (
    ts.isBinaryExpression(parent) &&
    (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  )
}

// Returned from its function, on its own, as one of the values of the returned expression, or
// inside the returned object or array.
function isReturnedWhole(node: ts.Node): boolean {
  let current = unwrap(node)
  for (;;) {
    const parent = current.parent
    if (!parent) return false
    if (ts.isReturnStatement(parent)) return true
    if (ts.isArrowFunction(parent) && parent.body === current) return true
    if (isBranchOf(parent, current)) {
      current = unwrap(parent)
      continue
    }
    if (
      ts.isSpreadAssignment(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent)
    ) {
      current = parent.parent
      continue
    }
    if (ts.isObjectLiteralExpression(parent) || ts.isArrayLiteralExpression(parent)) {
      current = unwrap(parent)
      continue
    }
    return false
  }
}

function enclosingFunction(node: ts.Node) {
  for (let current = node.parent; current; current = current.parent)
    if (ts.isFunctionLike(current)) return current
  return undefined
}

function functionDefinition(fn: ts.SignatureDeclaration | undefined, file: string) {
  if (!fn) return undefined
  const name =
    fn.name && ts.isIdentifier(fn.name)
      ? fn.name.text
      : fn.parent && ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name)
        ? fn.parent.name.text
        : undefined
  if (!name || !/^use[A-Z]/.test(name)) return undefined
  const node = localDefinitions.get(file)?.get(name)
  return node ? { file, node } : undefined
}

function usesOf(fn: ts.Node | undefined, name: ts.Identifier) {
  const uses: ts.Identifier[] = []
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name.text && node !== name) uses.push(node)
    ts.forEachChild(node, visit)
  }
  if (fn) visit(fn)
  return uses
}

type Use = 'reads' | 'passes' | 'silent'

// The fields that carry the error: the query's own, or the error fields a hook derives from it.
let readNames: ReadonlySet<string> = errorReads
// The properties of a wrapper's returned object that hold the whole query result.
let carrierNames: ReadonlySet<string> = new Set()
const readsName = (name: string) => readNames.has(name)
const readText = () => new RegExp(`\\.(?:${[...readNames].join('|')})\\b`)

// The statement or JSX expression a node is part of.
function statementOf(node: ts.Node) {
  let statement: ts.Node = node
  while (statement.parent && !ts.isStatement(statement) && !ts.isJsxExpression(statement))
    statement = statement.parent
  return statement
}

function bindingUse(pattern: ts.ObjectBindingPattern, fn: ts.Node | undefined): Use {
  let use: Use = 'silent'
  for (const element of pattern.elements) {
    if (element.dotDotDotToken && ts.isIdentifier(element.name)) {
      const rest = identifierUse(element.name, fn)
      if (rest === 'reads') return 'reads'
      if (rest === 'passes') use = 'passes'
      continue
    }
    const key =
      element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : ts.isIdentifier(element.name)
          ? element.name.text
          : undefined
    if (key && readsName(key)) return 'reads'
    if (key && carrierNames.has(key) && ts.isIdentifier(element.name)) {
      const carried = identifierUse(element.name, fn)
      if (carried === 'reads') return 'reads'
      if (carried === 'passes') use = 'passes'
    }
  }
  return use
}

function identifierUse(name: ts.Identifier, fn: ts.Node | undefined): Use {
  let use: Use = 'silent'
  for (const reference of usesOf(fn, name)) {
    const parent = reference.parent
    if (ts.isPropertyAccessExpression(parent) && parent.expression === reference) {
      if (readsName(parent.name.text)) return 'reads'
      continue
    }
    // `[first, second].filter((query) => query.isError)` reads each element's error.
    if (ts.isArrayLiteralExpression(parent)) {
      if (readText().test(statementOf(parent).getText())) return 'reads'
      const alias = unwrap(parent).parent
      if (
        ts.isVariableDeclaration(alias) &&
        ts.isIdentifier(alias.name) &&
        usesOf(fn, alias.name).some((ref) => readText().test(statementOf(ref).getText()))
      )
        return 'reads'
      continue
    }
    // `return condition ? first : second` hands the result on whole.
    if (isReturnedWhole(reference)) {
      use = 'passes'
      continue
    }
    // `const query = condition ? first : second` hands the result on under another name.
    if (ts.isConditionalExpression(parent) && parent.condition !== reference) {
      const alias = unwrap(parent).parent
      if (ts.isVariableDeclaration(alias) && ts.isIdentifier(alias.name)) {
        const aliased = identifierUse(alias.name, fn)
        if (aliased === 'reads') return 'reads'
        if (aliased === 'passes') use = 'passes'
      }
      continue
    }
    if (
      ts.isVariableDeclaration(parent) &&
      parent.initializer === reference &&
      ts.isObjectBindingPattern(parent.name)
    ) {
      const bound = bindingUse(parent.name, fn)
      if (bound === 'reads') return 'reads'
      if (bound === 'passes') use = 'passes'
      continue
    }
    if (
      isReturnedWhole(reference) ||
      (ts.isCallExpression(parent) && parent.arguments.includes(reference)) ||
      ts.isJsxExpression(parent) ||
      ts.isSpreadAssignment(parent) ||
      ts.isSpreadElement(parent)
    )
      use = 'passes'
  }
  return use
}

// `useQueries` returns an array; its error is read through an element, usually in a callback.
function kindOfQueries(call: ts.CallExpression): Site['kind'] {
  const fn = enclosingFunction(call)
  const node = unwrap(call)
  const parent = node.parent
  if (isReturnedWhole(node)) return 'returns'
  if (!ts.isVariableDeclaration(parent) || !ts.isIdentifier(parent.name)) return 'passes'
  let kind: Site['kind'] = 'silent'
  for (const reference of usesOf(fn, parent.name)) {
    if (readText().test(statementOf(reference).getText())) return 'reads'
    if (isReturnedWhole(reference)) kind = 'passes'
  }
  return kind
}

function kindOf(call: ts.CallExpression): Site['kind'] {
  if (ts.isIdentifier(call.expression) && call.expression.text === 'useQueries')
    return kindOfQueries(call)
  const fn = enclosingFunction(call)
  const node = unwrap(call)
  const parent = node.parent
  if (isReturnedWhole(node)) return 'returns'
  if (ts.isVariableDeclaration(parent) && parent.initializer === node) {
    if (ts.isIdentifier(parent.name)) {
      const use = identifierUse(parent.name, fn)
      if (use === 'passes' && usesOf(fn, parent.name).some((ref) => isReturnedWhole(ref)))
        return 'returns'
      return use
    }
    if (ts.isObjectBindingPattern(parent.name)) return bindingUse(parent.name, fn)
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === node)
    return readsName(parent.name.text) ? 'reads' : 'silent'
  if (ts.isExpressionStatement(parent)) return 'unused'
  return 'passes'
}

const derivedErrorName = /error|failed/i

// The property of the returned object a query result is placed under, if any.
function carrierOf(node: ts.Node): string | undefined {
  let current = unwrap(node)
  let name: string | undefined
  for (;;) {
    const parent = current.parent
    if (!parent) return undefined
    if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === current))
      return name
    if (isBranchOf(parent, current)) {
      current = unwrap(parent)
      continue
    }
    if (
      (ts.isPropertyAssignment(parent) || ts.isShorthandPropertyAssignment(parent)) &&
      ts.isIdentifier(parent.name)
    ) {
      name ??= parent.name.text
      current = parent.parent
      continue
    }
    if (ts.isSpreadAssignment(parent)) {
      current = parent.parent
      continue
    }
    if (ts.isObjectLiteralExpression(parent) || ts.isArrayLiteralExpression(parent)) {
      current = unwrap(parent)
      continue
    }
    return undefined
  }
}

function carriersOf(call: ts.CallExpression) {
  const carriers = new Set<string>()
  const node = unwrap(call)
  const direct = carrierOf(node)
  if (direct) carriers.add(direct)
  const parent = node.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    for (const reference of usesOf(enclosingFunction(call), parent.name)) {
      const carrier = ts.isShorthandPropertyAssignment(reference.parent)
        ? carrierOf(reference.parent.name)
        : carrierOf(reference)
      if (carrier) carriers.add(carrier)
    }
  }
  return carriers
}

// The error fields a hook's returned object derives from a query's error, such as `loadError`.
function derivedErrorFields(fn: ts.SignatureDeclaration | undefined) {
  const fields = new Set<string>()
  if (!fn || !('body' in fn) || !fn.body) return fields
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node) && node !== fn) return
    if (ts.isReturnStatement(node) && node.expression) {
      const returned = unwrap(node.expression)
      const object = ts.isObjectLiteralExpression(node.expression) ? node.expression : returned
      if (ts.isObjectLiteralExpression(object)) {
        for (const property of object.properties) {
          const name =
            property.name && ts.isIdentifier(property.name) ? property.name.text : undefined
          const value = ts.isShorthandPropertyAssignment(property)
            ? property.name
            : ts.isPropertyAssignment(property)
              ? property.initializer
              : undefined
          if (
            name &&
            derivedErrorName.test(name) &&
            value &&
            originOf(value, fn.getSourceFile().fileName) === 'queryError'
          )
            fields.add(name)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(fn.body)
  return fields
}

// The wrapper hooks found so far; `collectSites` fills it while it walks to a fixed point.
const producers = new Map<string, Definition>()

function collectSites() {
  const producerReads = new Map<string, ReadonlySet<string>>()
  const producerCarriers = new Map<string, ReadonlySet<string>>()
  let sites: Site[] = []
  for (let round = 0; round < 8; round++) {
    const before = producers.size
    sites = []
    for (const [file, sf] of sources) {
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
          const callee = node.expression.text
          let producer: string | undefined
          if (baseHooks.has(callee) || callee === 'useQueries') {
            producer = callee
          } else {
            const definition = definitionOf(file, callee)
            if (definition && producers.has(keyOf(definition))) producer = keyOf(definition)
          }
          if (producer) {
            readNames = producerReads.get(producer) ?? errorReads
            carrierNames = producerCarriers.get(producer) ?? new Set()
            let kind = kindOf(node)
            readNames = errorReads
            carrierNames = new Set()
            const fn = enclosingFunction(node)
            const wrapper = functionDefinition(fn, file)
            if (kind === 'returns' && wrapper) {
              producers.set(keyOf(wrapper), wrapper)
              const carriers = carriersOf(node)
              if (carriers.size > 0) producerCarriers.set(keyOf(wrapper), carriers)
            } else if (kind === 'reads' && wrapper) {
              // A hook that reads the error and returns fields derived from it hands it on too.
              const fields = derivedErrorFields(fn)
              if (fields.size > 0) {
                kind = 'forwards'
                producers.set(keyOf(wrapper), wrapper)
                producerReads.set(keyOf(wrapper), new Set([...errorReads, ...fields]))
              }
            }
            const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
            sites.push({
              file,
              line,
              call: node,
              callee,
              producer,
              kind,
              wrapper:
                (kind === 'returns' || kind === 'forwards') && wrapper ? keyOf(wrapper) : undefined,
            })
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
    if (producers.size === before) break
  }
  return { sites }
}

const isQueryCall = (call: ts.CallExpression, file: string) => {
  if (!ts.isIdentifier(call.expression)) return false
  const callee = call.expression.text
  if (baseHooks.has(callee) || callee === 'useQueries') return true
  const definition = definitionOf(file, callee)
  return !!definition && producers.has(keyOf(definition))
}

const isOwnedCall = (node: ts.Node) =>
  ts.isCallExpression(node) &&
  ts.isIdentifier(node.expression) &&
  ownedHooks.has(node.expression.text)

const optOutMeta = /\berrorToast:\s*false\b/

// Whether a query's options, or the local variable they come from, opt out of the toasts.
function optsOut(call: ts.CallExpression) {
  // A wrapper hook that opts its query out does so for every caller.
  if (ts.isIdentifier(call.expression)) {
    const definition = definitionOf(call.getSourceFile().fileName, call.expression.text)
    if (
      definition &&
      producers.has(keyOf(definition)) &&
      optOutMeta.test(definition.node.getText())
    )
      return true
  }
  return call.arguments.some((argument) => {
    if (optOutMeta.test(argument.getText())) return true
    let opted = false
    const visit = (node: ts.Node) => {
      if (opted) return
      if (ts.isIdentifier(node) && !isPropertyName(node)) {
        const declaration = declarationOf(node)
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer)
          opted = optOutMeta.test(declaration.initializer.getText())
      }
      ts.forEachChild(node, visit)
    }
    visit(argument)
    return opted
  })
}

// What a value is: a query's result (or part of one that still holds its error), the query's
// error, or neither. A claimed error from `useOwnedQueryError` is neither.
type Origin = 'queryError' | 'queryResult' | 'none'
const rank: Record<Origin, number> = { none: 0, queryResult: 1, queryError: 2 }
const strongest = (origins: Origin[]) =>
  origins.reduce<Origin>((best, origin) => (rank[origin] > rank[best] ? origin : best), 'none')
const elementMethods = new Set(['filter', 'find', 'at', 'slice', 'concat', 'flat', 'toSorted'])

// The declaration a name refers to in the functions around `node`, innermost first.
function declarationOf(node: ts.Identifier): ts.Node | undefined {
  for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
    if (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) continue
    let found: ts.Node | undefined
    const visit = (current: ts.Node) => {
      if (found) return
      if (current !== scope && ts.isFunctionLike(current)) return
      if (
        (ts.isVariableDeclaration(current) || ts.isBindingElement(current)) &&
        ts.isIdentifier(current.name) &&
        current.name.text === node.text
      )
        found = current
      ts.forEachChild(current, visit)
    }
    if ('body' in scope && scope.body) visit(scope.body)
    else if (ts.isSourceFile(scope)) visit(scope)
    if (found) return found
    if (ts.isFunctionLike(scope)) {
      for (const parameter of scope.parameters) {
        if (ts.isIdentifier(parameter.name) && parameter.name.text === node.text) return parameter
        if (ts.isObjectBindingPattern(parameter.name)) {
          const element = parameter.name.elements.find(
            (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === node.text,
          )
          if (element) return element
        }
      }
    }
  }
  return undefined
}

// The declaration a function is known by: itself, or the variable it is assigned to, also through
// a wrapper such as `memo(...)`.
function functionDeclarationNode(fn: ts.Node): ts.Node | undefined {
  if (ts.isFunctionDeclaration(fn)) return fn
  let current: ts.Node = fn
  while (
    current.parent &&
    (ts.isCallExpression(current.parent) || ts.isParenthesizedExpression(current.parent))
  )
    current = current.parent
  return ts.isVariableDeclaration(current.parent) ? current.parent : undefined
}

type Usage = { file: string; node: ts.JsxOpeningLikeElement | ts.CallExpression }
let usageIndex: Map<ts.Node, Usage[]> | undefined

// Where each function is rendered as a component or called, by its declaration.
function usagesOf(declaration: ts.Node) {
  if (!usageIndex) {
    const index = new Map<ts.Node, Usage[]>()
    for (const [file, sf] of sources) {
      const visit = (node: ts.Node) => {
        const callee =
          (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
          ts.isIdentifier(node.tagName)
            ? node.tagName
            : ts.isCallExpression(node) && ts.isIdentifier(node.expression)
              ? node.expression
              : undefined
        if (callee) {
          const definition = definitionOf(file, callee.text)
          if (definition) {
            const usages = index.get(definition.node) ?? []
            usages.push({ file, node: node as Usage['node'] })
            index.set(definition.node, usages)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
    usageIndex = index
  }
  return usageIndex.get(declaration) ?? []
}

const propertyOrigin = (base: Origin, property: string): Origin => {
  if (base !== 'queryResult') return 'none'
  if (errorAccess.test(property)) return 'queryError'
  return property === 'data' ? 'none' : 'queryResult'
}

// What the callers of a function pass for one of its parameters, or one property of it.
function parameterOrigin(
  parameter: ts.ParameterDeclaration,
  property: string | undefined,
  seen: Set<ts.Node>,
): Origin {
  const fn = parameter.parent
  const position = fn.parameters.indexOf(parameter)
  const declaration = functionDeclarationNode(fn)
  if (!declaration) return 'none'
  const origins: Origin[] = []
  for (const usage of usagesOf(declaration)) {
    if (ts.isCallExpression(usage.node)) {
      const argument = usage.node.arguments[position]
      if (!argument) continue
      if (property === undefined) {
        origins.push(originOf(argument, usage.file, seen))
        continue
      }
      if (ts.isObjectLiteralExpression(argument)) {
        const value = argument.properties.find(
          (candidate) =>
            candidate.name && ts.isIdentifier(candidate.name) && candidate.name.text === property,
        )
        if (value && ts.isPropertyAssignment(value))
          origins.push(originOf(value.initializer, usage.file, seen))
        else if (value && ts.isShorthandPropertyAssignment(value))
          origins.push(originOf(value.name, usage.file, seen))
        continue
      }
      origins.push(propertyOrigin(originOf(argument, usage.file, seen), property))
      continue
    }
    if (position !== 0 || property === undefined) continue
    for (const attribute of usage.node.attributes.properties) {
      if (
        ts.isJsxAttribute(attribute) &&
        ts.isIdentifier(attribute.name) &&
        attribute.name.text === property &&
        attribute.initializer &&
        ts.isJsxExpression(attribute.initializer) &&
        attribute.initializer.expression
      )
        origins.push(originOf(attribute.initializer.expression, usage.file, seen))
    }
  }
  return strongest(origins)
}

// The initializer a binding takes its value from, and the property it reads there, if any.
function sourceOf(declaration: ts.Node): { init?: ts.Expression; property?: string } {
  if (ts.isVariableDeclaration(declaration)) return { init: declaration.initializer }
  if (ts.isBindingElement(declaration)) {
    const property =
      declaration.propertyName && ts.isIdentifier(declaration.propertyName)
        ? declaration.propertyName.text
        : ts.isIdentifier(declaration.name)
          ? declaration.name.text
          : undefined
    let pattern: ts.Node = declaration.parent
    while (ts.isBindingElement(pattern.parent)) pattern = pattern.parent.parent
    const holder = pattern.parent
    return {
      init: ts.isVariableDeclaration(holder) ? holder.initializer : undefined,
      property,
    }
  }
  return {}
}

function originOf(node: ts.Node, file: string, seen = new Set<ts.Node>()): Origin {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isJsxExpression(node)
  )
    return node.expression ? originOf(node.expression, file, seen) : 'none'
  if (ts.isCallExpression(node)) {
    if (isOwnedCall(node)) return 'none'
    if (isQueryCall(node, file)) return optsOut(node) ? 'none' : 'queryResult'
    // `queries.filter(…)`, `queries.find(…)` and the like keep the elements.
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      elementMethods.has(node.expression.name.text)
    )
      return originOf(node.expression.expression, file, seen) === 'queryResult'
        ? 'queryResult'
        : 'none'
    return 'none'
  }
  if (ts.isPropertyAccessExpression(node)) {
    // `props.loadError`: what the callers pass for that prop.
    if (ts.isIdentifier(node.expression)) {
      const declaration = declarationOf(node.expression)
      if (declaration && ts.isParameter(declaration)) {
        if (seen.has(declaration)) return 'none'
        seen.add(declaration)
        const passed = parameterOrigin(declaration, node.name.text, seen)
        seen.delete(declaration)
        return passed
      }
    }
    const base = originOf(node.expression, file, seen)
    if (base !== 'queryResult') return 'none'
    const name = node.name.text
    if (errorAccess.test(name)) return 'queryError'
    return name === 'data' ? 'none' : 'queryResult'
  }
  if (ts.isElementAccessExpression(node))
    return originOf(node.expression, file, seen) === 'queryResult' ? 'queryResult' : 'none'
  if (ts.isConditionalExpression(node))
    return strongest([originOf(node.whenTrue, file, seen), originOf(node.whenFalse, file, seen)])
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind
    if (
      operator === ts.SyntaxKind.QuestionQuestionToken ||
      operator === ts.SyntaxKind.BarBarToken ||
      operator === ts.SyntaxKind.AmpersandAmpersandToken
    )
      return strongest([
        operator === ts.SyntaxKind.AmpersandAmpersandToken
          ? 'none'
          : originOf(node.left, file, seen),
        originOf(node.right, file, seen),
      ])
    return 'none'
  }
  if (ts.isArrayLiteralExpression(node))
    return strongest(node.elements.map((element) => originOf(element, file, seen)))
  if (ts.isObjectLiteralExpression(node))
    return strongest(
      node.properties.map((property) =>
        ts.isPropertyAssignment(property)
          ? originOf(property.initializer, file, seen) === 'queryError'
            ? 'queryError'
            : 'none'
          : ts.isShorthandPropertyAssignment(property)
            ? originOf(property.name, file, seen) === 'queryError'
              ? 'queryError'
              : 'none'
            : ts.isSpreadAssignment(property)
              ? originOf(property.expression, file, seen) === 'queryError'
                ? 'queryError'
                : 'none'
              : 'none',
      ),
    )
  if (ts.isIdentifier(node)) {
    const declaration = declarationOf(node)
    if (!declaration || seen.has(declaration)) return 'none'
    seen.add(declaration)
    if (ts.isParameter(declaration)) return parameterOrigin(declaration, undefined, seen)
    if (
      ts.isBindingElement(declaration) &&
      ts.isObjectBindingPattern(declaration.parent) &&
      ts.isParameter(declaration.parent.parent)
    ) {
      const key =
        declaration.propertyName && ts.isIdentifier(declaration.propertyName)
          ? declaration.propertyName.text
          : ts.isIdentifier(declaration.name)
            ? declaration.name.text
            : undefined
      return key ? parameterOrigin(declaration.parent.parent, key, seen) : 'none'
    }
    const { init, property } = sourceOf(declaration)
    if (!init) return 'none'
    const base = originOf(init, file, seen)
    if (property === undefined) return base
    if (base !== 'queryResult') return 'none'
    if (errorAccess.test(property)) return 'queryError'
    return property === 'data' ? 'none' : 'queryResult'
  }
  return 'none'
}

function isPropertyName(node: ts.Identifier) {
  const parent = node.parent
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isJsxAttribute(parent) && parent.name === node)
  )
}

const messageModules = new Set([
  'service/use-request-error-message.ts',
  'service/request-error-message.ts',
])

type Sink = { id: string; text: string; argument: ts.Node; file: string }

// Where an error is rendered: its message, a describer, or a component's error prop.
function sinks() {
  const found: Sink[] = []
  for (const [file, sf] of sources) {
    // The message helpers themselves describe whatever their callers pass.
    if (messageModules.has(path.relative(webRoot, file))) continue
    const describers = new Set<string>()
    const add = (node: ts.Node, argument: ts.Node | undefined) => {
      if (!argument) return
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
      found.push({
        id: `${path.relative(webRoot, file)}:${line}`,
        text: node.getText().split('\n')[0]!.slice(0, 80),
        argument,
        file,
      })
    }
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'useRequestErrorDescriber'
      )
        describers.add(node.name.text)
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const callee = node.expression.text
        if (
          callee === 'useRequestErrorMessage' ||
          callee === 'describeRequestError' ||
          describers.has(callee)
        )
          add(node, node.arguments[0])
      }
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && /error/i.test(node.name.text))
        add(node, node.initializer)
      if (ts.isJsxSpreadAttribute(node)) {
        const tag = node.parent.parent
        if (
          (ts.isJsxOpeningElement(tag) || ts.isJsxSelfClosingElement(tag)) &&
          /Error/.test(tag.tagName.getText())
        )
          add(node, node.expression)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return found
}

const { sites } = collectSites()

describe('query error claims', () => {
  it('finds the query hooks and the wrappers that hand their results on', () => {
    expect(sites.length).toBeGreaterThan(500)
    expect(producers.size).toBeGreaterThan(10)
  })

  it('renders a query error only through useOwnedQueryError', () => {
    const unclaimed = sinks()
      .filter((sink) => originOf(sink.argument, sink.file) === 'queryError')
      .map((sink) => `${sink.id} ${sink.text}`)
    expect(unclaimed).toEqual([])
  })

  it('declares no errorOwner, which the query cache no longer reads', () => {
    const declared: string[] = []
    for (const [file, sf] of sources) {
      const text = sf.getFullText()
      if (/\berrorOwner\b/.test(text)) declared.push(path.relative(webRoot, file))
    }
    expect(declared).toEqual([])
  })
})
