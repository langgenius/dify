import type { ModuleResolutions } from './compiler'
import type { RouteNamespacePolicy } from './route-policy'
import path from 'node:path'
import * as ts from 'typescript'
import { createTranslationApiResolver } from './api'
import { camelCase, readTranslationCatalog } from './catalog'
import { createTranslationProgram, readCompilerOptions } from './compiler'
import { createRoutePolicyMatcher } from './route-policy'

const MAX_VALUES = 200
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Translation = { namespaces: string[]; prefix: string; argument: number }
type Value = ts.Expression | ts.FunctionDeclaration
type Key = { text: string; wildcard?: boolean; namespace?: string }

function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isAwaitExpression(node)
  )
    return unwrap(node.expression)
  return node
}

function literalTypes(type: ts.Type): string[] | undefined {
  if (type.isStringLiteral()) return [type.value]
  if (type.isUnion()) {
    const values: string[] = []
    for (const member of type.types) {
      if (member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)) continue
      const literals = literalTypes(member)
      if (!literals) return
      values.push(...literals)
      if (values.length > MAX_VALUES) return
    }
    return values.length ? [...new Set(values)] : undefined
  }
}

function initializer(node: ts.Node): Value | undefined {
  if (
    ts.isVariableDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isParameter(node) ||
    ts.isPropertyDeclaration(node)
  )
    return node.initializer
  if (ts.isShorthandPropertyAssignment(node)) return node.name
  if (ts.isFunctionDeclaration(node) && node.body) return node
}

export type AnalysisEvidence = {
  kind: 'usage' | 'dynamic-key' | 'unresolved-import' | 'unknown-namespace' | 'route-namespace-load'
  moduleId: string
  file: string
  line: number
  column: number
  namespaces: string[]
  message: string
  import?: {
    specifier: string
    kind: 'style' | 'asset' | 'package' | 'virtual' | 'source'
    origin: 'source' | 'generated'
  }
}

export function createAnalysisContext(root: string, routeNamespacePolicy?: RouteNamespacePolicy) {
  return {
    translations: readTranslationCatalog(root),
    compilerOptions: readCompilerOptions(root),
    routeNamespacePolicy,
  }
}

// Only module IDs supplied by Vite are visited. Type dependencies inform static
// expressions but never contribute usage merely by existing on disk.
export function checkTranslationGraph(
  root: string,
  modules: ReadonlyMap<string, string>,
  resolutions: ModuleResolutions = new Map(),
  context = createAnalysisContext(root),
) {
  const { catalog } = context.translations
  const programStarted = performance.now()
  const { program, fileNames } = createTranslationProgram(
    root,
    modules,
    resolutions,
    context.compilerOptions,
  )
  const checker = program.getTypeChecker()
  const programMs = performance.now() - programStarted
  const analysisStarted = performance.now()
  const translationApi = createTranslationApiResolver(root, checker)
  const routePolicy = createRoutePolicyMatcher(root, checker, context.routeNamespacePolicy)
  const evidence = new Map<string, AnalysisEvidence>()
  let currentModule = ''
  let currentSite: ts.Node | undefined
  function explain(
    kind: AnalysisEvidence['kind'],
    namespaces: string[],
    message: string,
    importInfo?: AnalysisEvidence['import'],
  ) {
    if (!currentSite) return
    const location = currentSite
      .getSourceFile()
      .getLineAndCharacterOfPosition(currentSite.getStart())
    const item = {
      kind,
      moduleId: currentModule,
      file: path.relative(root, currentModule.split('?')[0]!).replaceAll('\\', '/'),
      line: location.line + 1,
      column: location.character + 1,
      namespaces: [...namespaces].sort(),
      message,
      ...(importInfo ? { import: importInfo } : {}),
    }
    evidence.set(JSON.stringify(item), item)
  }
  const used = new Map<string, Set<string>>()
  const protectedNamespaces = new Set<string>()
  const moduleNamespaces = new Map<string, Set<string>>()
  let currentNamespaces = new Set<string>()

  function declarations(node: ts.Node): readonly ts.Declaration[] {
    const symbol = checker.getSymbolAtLocation(node)
    const local = symbol?.declarations ?? []
    return symbol && symbol.flags & ts.SymbolFlags.Alias
      ? [...local, ...(checker.getAliasedSymbol(symbol).declarations ?? [])]
      : local
  }

  function alternatives(expression: Value, seen = new Set<ts.Node>()): (Value | undefined)[] {
    if (ts.isFunctionDeclaration(expression)) return [expression]
    if (
      (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) &&
      /I18nKeys(?:By|With)Prefix/.test(expression.type.getText())
    )
      return [expression]
    const node = unwrap(expression)
    if (seen.has(node)) return [undefined]
    const next = new Set(seen).add(node)
    if (ts.isConditionalExpression(node))
      return [...alternatives(node.whenTrue, next), ...alternatives(node.whenFalse, next)]
    if (ts.isCallExpression(node)) {
      for (const fn of alternatives(node.expression, next)) {
        if (
          !fn ||
          !(
            ts.isArrowFunction(fn) ||
            ts.isFunctionExpression(fn) ||
            ts.isFunctionDeclaration(fn)
          ) ||
          !fn.body
        )
          continue
        const body = ts.isBlock(fn.body)
          ? fn.body.statements.length === 1 && ts.isReturnStatement(fn.body.statements[0]!)
            ? fn.body.statements[0]!.expression
            : undefined
          : fn.body
        if (!body) continue
        const returned = unwrap(body)
        const index = fn.parameters.findIndex(
          (parameter) => parameter.name.getText() === returned.getText(),
        )
        if (index >= 0 && node.arguments[index]) return alternatives(node.arguments[index]!, next)
      }
    }
    if (ts.isIdentifier(node)) {
      if (node.text === 'undefined') return []
      const values = declarations(node)
        .map(initializer)
        .filter((value) => value !== undefined)
      return values.length ? values.flatMap((value) => alternatives(value, next)) : [node]
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const object = checker.getTypeAtLocation(node.expression)
      const names = ts.isPropertyAccessExpression(node)
        ? [node.name.text]
        : strings(node.argumentExpression)
      const objects = alternatives(node.expression, next)
      if (objects.some((value) => value && ts.isObjectLiteralExpression(value))) {
        const select = (value: Value | undefined): (Value | undefined)[] => {
          if (!value || !ts.isObjectLiteralExpression(value)) return [undefined]
          return value.properties.flatMap((member) => {
            if (ts.isSpreadAssignment(member))
              return alternatives(member.expression, next).flatMap(select)
            const memberNames =
              member.name && ts.isComputedPropertyName(member.name)
                ? strings(member.name.expression)
                : member.name
                  ? [member.name.getText().replace(/^['"]|['"]$/g, '')]
                  : undefined
            if (names && memberNames && !memberNames.some((name) => names.includes(name))) return []
            const value = initializer(member)
            return value ? alternatives(value, next) : [undefined]
          })
        }
        return objects.flatMap(select)
      }
      const symbols = names ? names.map((name) => object.getProperty(name)) : object.getProperties()
      const values = symbols.flatMap(
        (symbol) => symbol?.declarations?.map(initializer) ?? [undefined],
      )
      // An open index signature can supply entries absent from the finite map.
      if (!names && object.getStringIndexType()) values.push(undefined)
      if (values.length)
        return values.flatMap((value) => (value ? alternatives(value, next) : [undefined]))
    }
    return [node]
  }

  function strings(expression: ts.Expression | undefined): string[] | undefined {
    if (!expression) return
    const node = unwrap(expression)
    if (ts.isStringLiteralLike(node)) return [node.text]
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map((element) => strings(element))
      return values.every((value) => value !== undefined) ? values.flat() : undefined
    }
    return literalTypes(checker.getTypeAtLocation(expression))
  }

  function property(
    expression: ts.Expression | undefined,
    name: string,
  ): ts.Expression | undefined {
    if (!expression) return
    const node = unwrap(expression)
    if (!ts.isObjectLiteralExpression(node)) return
    for (const member of node.properties) {
      if (ts.isShorthandPropertyAssignment(member) && member.name.text === name) return member.name
      if (
        ts.isPropertyAssignment(member) &&
        member.name.getText().replace(/^['"]|['"]$/g, '') === name
      )
        return member.initializer
    }
  }

  function selectorType(type: ts.Type): ts.Type | undefined {
    if (type.aliasSymbol?.getName() === 'SelectorParam') return type
    const constraint = checker.getBaseConstraintOfType(type)
    return constraint && constraint !== type ? selectorType(constraint) : undefined
  }

  function typedTranslation(node: ts.Node, call?: ts.CallExpression): Translation | undefined {
    const type = checker.getTypeAtLocation(node)
    const brand = type.getProperty('$TFunctionBrand')
    if (brand) {
      const namespaces = literalTypes(checker.getTypeOfSymbolAtLocation(brand, node))
      if (namespaces?.length) return { namespaces, prefix: '', argument: 0 }
    }
    // Prefer the instantiated namespace. Inferred selector functions can lose
    // their alias, so retain declaration signatures for recognizing adapters.
    const resolved = call && checker.getResolvedSignature(call)
    const signatures = [...(resolved ? [resolved] : []), ...type.getCallSignatures()]
    for (const signature of signatures) {
      for (const [argument, parameter] of signature.parameters.entries()) {
        const selector = selectorType(checker.getTypeOfSymbolAtLocation(parameter, node))
        if (!selector) continue
        const namespaceType = selector.aliasTypeArguments?.[0]
        const namespaces = namespaceType ? literalTypes(namespaceType) : undefined
        return { namespaces: namespaces ?? [...catalog.keys()], prefix: '', argument }
      }
    }
  }

  function translation(
    node: ts.Expression,
    call?: ts.CallExpression,
    seen = new Set<ts.Node>(),
  ): Translation | undefined {
    if (seen.has(node)) return
    seen.add(node)
    for (const declaration of declarations(
      ts.isPropertyAccessExpression(node) ? node.name : node,
    )) {
      if (
        ts.isBindingElement(declaration) &&
        (declaration.propertyName ?? declaration.name).getText() === 't'
      ) {
        const variable = declaration.parent.parent
        if (ts.isParameter(variable))
          return typedTranslation(node, call) ?? { namespaces: ['app'], prefix: '', argument: 0 }
        if (ts.isVariableDeclaration(variable) && variable.initializer) {
          const call = unwrap(variable.initializer)
          if (ts.isCallExpression(call)) {
            const api = translationApi(call.expression)
            if (api === 'useTranslation' || api === 'getTranslation') {
              const nsIndex = api === 'getTranslation' ? 1 : 0
              return {
                namespaces:
                  strings(call.arguments[nsIndex]) ??
                  (call.arguments[nsIndex] ? [...catalog.keys()] : ['app']),
                prefix: strings(property(call.arguments[nsIndex + 1], 'keyPrefix'))?.[0] ?? '',
                argument: 0,
              }
            }
          }
        }
      }
      if (
        ts.isImportSpecifier(declaration) &&
        (declaration.propertyName ?? declaration.name).text === 't'
      ) {
        const importDeclaration = declaration.parent.parent.parent
        if (
          ts.isImportDeclaration(importDeclaration) &&
          ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
          importDeclaration.moduleSpecifier.text === 'i18next'
        )
          return { namespaces: ['app'], prefix: '', argument: 0 }
      }
      if (ts.isParameter(declaration)) {
        const match = declaration.type?.getText().match(/TFunction\s*<\s*['"]([^'"]+)/)
        if (match) return { namespaces: [match[1]!], prefix: '', argument: 0 }
        const typed = typedTranslation(node, call)
        if (typed) return typed
        if (declaration.name.getText() === 't')
          return { namespaces: ['app'], prefix: '', argument: 0 }
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const alias = translation(unwrap(declaration.initializer), call, seen)
        if (alias) return alias
      }
    }
    const typed = typedTranslation(node, call)
    if (typed) return typed
    if (ts.isPropertyAccessExpression(node) && node.name.text === 't')
      return { namespaces: ['app'], prefix: '', argument: 0 }
  }

  function keyPatterns(expression: ts.Expression): Key[] {
    const node = unwrap(expression)
    if (ts.isCallExpression(node) || ts.isIdentifier(node)) {
      const values = alternatives(node)
      if (
        values.some((value) => value !== node) &&
        (ts.isCallExpression(node) ||
          values.some(
            (value) =>
              value && !ts.isFunctionDeclaration(value) && ts.isTemplateExpression(unwrap(value)),
          ))
      ) {
        return values.flatMap((value) =>
          value && !ts.isFunctionDeclaration(value)
            ? keyPatterns(value)
            : [{ text: '.*', wildcard: true }],
        )
      }
    }
    const values = ts.isTemplateExpression(node) ? undefined : strings(expression)
    if (values) return values.map((text) => ({ text }))
    if (
      (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) &&
      ts.isTypeReferenceNode(expression.type) &&
      /I18nKeys(?:By|With)Prefix$/.test(expression.type.typeName.getText())
    ) {
      const prefix = expression.type.typeArguments?.[1]
      if (prefix && ts.isLiteralTypeNode(prefix) && ts.isStringLiteral(prefix.literal))
        return [{ text: `${escapeRegex(prefix.literal.text)}.*`, wildcard: true }]
    }
    if (ts.isTemplateExpression(node)) {
      let patterns = [escapeRegex(node.head.text)]
      for (const span of node.templateSpans) {
        const values = strings(span.expression)?.map(escapeRegex) ?? ['.*']
        if (patterns.length * values.length > MAX_VALUES) return [{ text: '.*', wildcard: true }]
        patterns = patterns.flatMap((prefix) =>
          values.map((value) => prefix + value + escapeRegex(span.literal.text)),
        )
      }
      return patterns.map((text) => ({ text, wildcard: true }))
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = keyPatterns(node.left)
      const right = keyPatterns(node.right)
      if (left.length * right.length > MAX_VALUES) return [{ text: '.*', wildcard: true }]
      return left.flatMap((a) =>
        right.map((b) => ({
          text:
            (a.wildcard ? a.text : escapeRegex(a.text)) +
            (b.wildcard ? b.text : escapeRegex(b.text)),
          wildcard: true,
        })),
      )
    }
    return [{ text: '.*', wildcard: true }]
  }

  function selectorKeys(
    node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  ): Key[] {
    const source = node.parameters[0]?.name
    if (!source || !node.body) return [{ text: '.*', wildcard: true }]
    const returns: ts.Expression[] = []
    if (ts.isBlock(node.body)) {
      const visit = (child: ts.Node) => {
        if (ts.isReturnStatement(child) && child.expression) returns.push(child.expression)
        else if (!ts.isFunctionLike(child)) ts.forEachChild(child, visit)
      }
      ts.forEachChild(node.body, visit)
    } else returns.push(node.body)

    const access = (expression: ts.Expression): Key[] => {
      const value = unwrap(expression)
      if (ts.isConditionalExpression(value))
        return [...access(value.whenTrue), ...access(value.whenFalse)]
      const chain: (ts.Expression | string)[] = []
      let current = value
      while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
        chain.unshift(
          ts.isPropertyAccessExpression(current) ? current.name.text : current.argumentExpression,
        )
        current = unwrap(current.expression)
      }
      if (current.getText() !== source.getText() || !chain.length)
        return [{ text: '.*', wildcard: true }]
      const key = chain.at(-1)!
      const keys = typeof key === 'string' ? [{ text: key }] : keyPatterns(key)
      if (chain.length === 1) return keys
      const namespacePart = chain[0]!
      const namespaces =
        typeof namespacePart === 'string' ? [namespacePart] : strings(namespacePart)
      if (!namespaces?.length) return [{ text: '.*', wildcard: true, namespace: '*' }]
      return namespaces.flatMap((namespace) => keys.map((key) => ({ ...key, namespace })))
    }
    return returns.length ? returns.flatMap(access) : [{ text: '.*', wildcard: true }]
  }

  function record(keys: Key[], info: Translation) {
    for (const key of keys) {
      const separator = key.text.indexOf(':')
      const namespaces = key.namespace
        ? key.namespace === '*'
          ? [...catalog.keys()]
          : [key.namespace]
        : separator > 0
          ? key.wildcard
            ? [...catalog.keys()].filter((namespace) =>
                new RegExp(`^${key.text.slice(0, separator)}$`).test(namespace),
              )
            : [key.text.slice(0, separator)]
          : info.namespaces
      const text = separator > 0 && !key.namespace ? key.text.slice(separator + 1) : key.text
      for (const rawNamespace of namespaces) {
        const namespace = camelCase(rawNamespace)
        currentNamespaces.add(namespace)
        if (!catalog.has(namespace)) continue
        if (key.wildcard && text === '.*' && !info.prefix) {
          protectedNamespaces.add(namespace)
          explain(
            'dynamic-key',
            [namespace],
            'The key cannot be narrowed; every key in this namespace is protected.',
          )
          continue
        }
        const prefix = info.prefix ? `${info.prefix}.` : ''
        const kept = used.get(namespace) ?? new Set<string>()
        const matches = context.translations.match(
          namespace,
          key.wildcard ? `${escapeRegex(prefix)}${text}` : prefix + text,
          !!key.wildcard,
        )
        for (const candidate of matches) kept.add(candidate)
        explain(
          'usage',
          [namespace],
          key.wildcard ? `Static key pattern: ${prefix}${text}` : `Static key: ${prefix}${text}`,
        )
        used.set(namespace, kept)
      }
    }
  }

  function consume(expression: ts.Expression, info: Translation) {
    // Typed forwarding adapters are checked at their concrete call sites.
    if (
      ts.isIdentifier(expression) &&
      selectorType(checker.getTypeAtLocation(expression)) &&
      declarations(expression).some(ts.isParameter)
    )
      return
    for (const value of alternatives(expression)) {
      if (
        value &&
        (ts.isArrowFunction(value) ||
          ts.isFunctionExpression(value) ||
          ts.isFunctionDeclaration(value))
      ) {
        record(selectorKeys(value), info)
      } else {
        record(
          value && !ts.isFunctionDeclaration(value)
            ? keyPatterns(value)
            : [{ text: '.*', wildcard: true }],
          info,
        )
      }
    }
  }

  const writtenParameters = new Set<ts.ParameterDeclaration>()
  function recordLoadedNamespaces(expression: ts.Expression, seen = new Set<ts.Node>()): boolean {
    const node = unwrap(expression)
    if (seen.has(node)) return false
    if (
      declarations(node).some(
        (declaration) => ts.isParameter(declaration) && writtenParameters.has(declaration),
      )
    )
      return false
    const next = new Set(seen).add(node)
    if (ts.isStringLiteralLike(node)) {
      currentNamespaces.add(node.text)
      explain('usage', [node.text], 'Explicit namespace load.')
      return true
    }
    if (ts.isArrayLiteralExpression(node))
      return node.elements.map((element) => recordLoadedNamespaces(element, next)).every(Boolean)
    if (ts.isSpreadElement(node)) return recordLoadedNamespaces(node.expression, next)
    const values = alternatives(node)
    // A finite type describes possibilities, not necessarily a concrete load.
    return (
      values.length > 0 &&
      values
        .map(
          (value) =>
            !!value && !ts.isFunctionDeclaration(value) && recordLoadedNamespaces(value, next),
        )
        .every(Boolean)
    )
  }

  // Summarize direct namespace forwarding before scanning usage. Attribute the
  // forwarded load to callers, not every route importing a shared wrapper.
  const forwarding = new Map<ts.FunctionDeclaration, Set<number>>()
  const calls: { node: ts.CallExpression; owner?: ts.FunctionDeclaration }[] = []
  function enclosingFunction(node: ts.Node): ts.FunctionDeclaration | undefined {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionLike(parent)) return ts.isFunctionDeclaration(parent) ? parent : undefined
    }
  }
  const targetCache = new Map<ts.Expression, ts.FunctionDeclaration[]>()
  function forwardingTargets(expression: ts.Expression) {
    let targets = targetCache.get(expression)
    if (!targets) {
      targets = alternatives(expression).filter(
        (value): value is ts.FunctionDeclaration =>
          !!value && ts.isFunctionDeclaration(value) && forwarding.has(value),
      )
      targetCache.set(expression, targets)
    }
    return targets
  }
  function forwardedParameters(
    expression: ts.Expression,
    owner: ts.FunctionDeclaration,
  ): Set<number> | undefined {
    const node = unwrap(expression)
    if (ts.isStringLiteralLike(node)) return new Set()
    if (ts.isSpreadElement(node)) return forwardedParameters(node.expression, owner)
    if (ts.isArrayLiteralExpression(node)) {
      const items = node.elements.map((item) => forwardedParameters(item, owner))
      return items.some((item) => !item) ? undefined : new Set(items.flatMap((item) => [...item!]))
    }
    if (ts.isIdentifier(node)) {
      const index = owner.parameters.findIndex(
        (parameter) => !writtenParameters.has(parameter) && declarations(node).includes(parameter),
      )
      if (index >= 0) return new Set([index])
    }
  }
  const checkedWrites = new Set<ts.Node>()
  const checkedEscapes = new Set<ts.Node>()
  function markWrites(target: ts.Node, indirect = false) {
    const checked = indirect ? checkedEscapes : checkedWrites
    if (checked.has(target)) return
    checked.add(target)
    if (indirect && ts.isFunctionLike(target)) return
    if (ts.isIdentifier(target)) {
      for (const declaration of declarations(target)) {
        if (ts.isParameter(declaration)) {
          if (!indirect || !isPrimitive(checker.getTypeAtLocation(target)))
            writtenParameters.add(declaration)
        } else if (ts.isVariableDeclaration(declaration) && declaration.initializer)
          markWrites(declaration.initializer, indirect)
      }
    }
    ts.forEachChild(target, (child) => markWrites(child, indirect))
  }
  for (const id of modules.keys()) {
    if (id.endsWith('.json')) continue
    const source = program.getSourceFile(fileNames.get(id)!)
    if (!source) continue
    const collect = (node: ts.Node) => {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        markWrites(node.left)
      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)
      )
        markWrites(node.operand)
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression))
        markWrites(node.expression.expression)
      if (ts.isFunctionDeclaration(node) && node.body) forwarding.set(node, new Set())
      if (ts.isCallExpression(node)) calls.push({ node, owner: enclosingFunction(node) })
      ts.forEachChild(node, collect)
    }
    collect(source)
  }
  // Only primitive arguments are immune to mutation by an arbitrary callee.
  function isPrimitive(type: ts.Type): boolean {
    if (type.isUnion()) return type.types.every(isPrimitive)
    const constraint = checker.getBaseConstraintOfType(type)
    if (constraint && constraint !== type) return isPrimitive(constraint)
    return !!(
      type.flags &
      (ts.TypeFlags.StringLike |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.BigIntLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.Null |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Never)
    )
  }
  for (const { node } of calls) {
    const api = translationApi(node.expression)
    if (api === 'useTranslation' || api === 'getTranslation') continue
    for (const argument of node.arguments) {
      if (!isPrimitive(checker.getTypeAtLocation(argument))) markWrites(argument, true)
    }
  }
  function forwardedArguments(
    node: ts.CallExpression,
    target: ts.FunctionDeclaration,
    index: number,
  ) {
    // A spread before a positional parameter makes its source ambiguous.
    const spread = node.arguments.slice(0, index).find(ts.isSpreadElement)
    if (spread) return undefined
    if (target.parameters[index]?.dotDotDotToken) return node.arguments.slice(index)
    const supplied = node.arguments[index]
    const undefinedValue =
      supplied && checker.getTypeAtLocation(supplied).flags & ts.TypeFlags.Undefined
    const argument = !supplied || undefinedValue ? target.parameters[index]?.initializer : supplied
    return argument ? [argument] : []
  }
  const calledFunctions = new Set(
    calls.flatMap(({ node }) => [node.expression, ...node.arguments].flatMap(forwardingTargets)),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const { node, owner } of calls) {
      if (!owner || !forwarding.has(owner)) continue
      const api = translationApi(node.expression)
      const args =
        api === 'useTranslation'
          ? node.arguments.slice(0, 1)
          : api === 'getTranslation'
            ? node.arguments.slice(1, 2)
            : forwardingTargets(node.expression).flatMap((target) =>
                [...forwarding.get(target)!].flatMap(
                  (index) => forwardedArguments(node, target, index) ?? [],
                ),
              )
      for (const argument of args) {
        for (const parameter of forwardedParameters(argument, owner) ?? []) {
          const summary = forwarding.get(owner)!
          if (!summary.has(parameter)) {
            summary.add(parameter)
            changed = true
          }
        }
      }
    }
  }
  const recursive = new Set<ts.FunctionDeclaration>()
  const adjacency = new Map<ts.FunctionDeclaration, Set<ts.FunctionDeclaration>>()
  for (const { node, owner } of calls) {
    if (!owner) continue
    const targets = adjacency.get(owner) ?? new Set<ts.FunctionDeclaration>()
    for (const target of forwardingTargets(node.expression)) targets.add(target)
    adjacency.set(owner, targets)
  }
  const finished = new Set<ts.FunctionDeclaration>()
  function findCycles(node: ts.FunctionDeclaration, stack: ts.FunctionDeclaration[]) {
    const index = stack.indexOf(node)
    if (index >= 0) {
      for (const item of stack.slice(index)) recursive.add(item)
      return
    }
    if (finished.has(node)) return
    if (stack.length >= 100) {
      for (const item of [...stack, node]) recursive.add(item)
      return
    }
    for (const target of adjacency.get(node) ?? []) findCycles(target, [...stack, node])
    finished.add(node)
  }
  for (const target of forwarding.keys()) findCycles(target, [])
  function escapedForwarders(expression: ts.Expression): boolean {
    if (forwardingTargets(expression).some((target) => forwarding.get(target)!.size)) return true
    const node = unwrap(expression)
    if (ts.isObjectLiteralExpression(node))
      return node.properties.some((member) =>
        ts.isSpreadAssignment(member)
          ? escapedForwarders(member.expression)
          : ts.isPropertyAssignment(member)
            ? escapedForwarders(member.initializer)
            : ts.isShorthandPropertyAssignment(member) && escapedForwarders(member.name),
      )
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(escapedForwarders)
    if (ts.isSpreadElement(node)) return escapedForwarders(node.expression)
    return false
  }
  function isForwarded(expression: ts.Expression) {
    const owner = enclosingFunction(expression)
    if (
      !owner ||
      recursive.has(owner) ||
      (!calledFunctions.has(owner) && !(owner.name && translationApi(owner.name)))
    )
      return false
    const parameters = forwardedParameters(expression, owner)
    return !!parameters?.size && [...parameters].every((index) => forwarding.get(owner)?.has(index))
  }

  function visit(node: ts.Node) {
    currentSite = node
    if (ts.isStringLiteralLike(node) && (node.text.includes('.') || node.text.includes(':'))) {
      const contextual = checker.getContextualType(node)
      const values = contextual && literalTypes(contextual)
      if (values?.includes(node.text)) {
        const namespaces = [...catalog]
          .filter(([, keys]) => values.every((value) => keys.has(value)))
          .map(([namespace]) => namespace)
        if (namespaces.length)
          record([{ text: node.text }], { namespaces, prefix: '', argument: 0 })
      }
    }
    if (ts.isCallExpression(node)) {
      currentSite = node
      const api = translationApi(node.expression)
      if (api === 'useTranslation' || api === 'getTranslation') {
        // Explicit loading requests matter even when their t function is unused.
        // Do not mark translation keys as used merely because a namespace loads.
        const nsIndex = api === 'getTranslation' ? 1 : 0
        const argument = node.arguments[nsIndex]
        if (argument && !isForwarded(argument) && !recordLoadedNamespaces(argument)) {
          if (routePolicy(argument))
            explain(
              'route-namespace-load',
              [],
              'Namespace load follows the configured current-route policy.',
            )
          else
            explain(
              'unknown-namespace',
              [],
              'The explicit namespace load cannot be fully resolved.',
            )
        }
      }
      if (api !== 'useTranslation' && api !== 'getTranslation') {
        for (const target of forwardingTargets(node.expression)) {
          for (const index of forwarding.get(target)!) {
            const argumentsToCheck = forwardedArguments(node, target, index)
            if (!argumentsToCheck) {
              explain(
                'unknown-namespace',
                [],
                'A spread prevents locating the forwarded namespace argument.',
              )
              continue
            }
            for (const argument of argumentsToCheck) {
              if (!isForwarded(argument) && !recordLoadedNamespaces(argument))
                explain(
                  'unknown-namespace',
                  [],
                  'The forwarded namespace cannot be resolved at this call site.',
                )
            }
          }
        }
      }
      for (const argument of node.arguments) {
        if (escapedForwarders(argument))
          explain(
            'unknown-namespace',
            [],
            'A namespace-forwarding function escapes through a call argument.',
          )
      }
      const info = translation(node.expression, node)
      const argument = info && node.arguments[info.argument]
      if (info && argument) {
        const options = node.arguments.at(-1)
        const namespaceOption = property(options, 'ns')
        const namespaces = strings(namespaceOption)
        if (namespaceOption && !namespaces && !isForwarded(namespaceOption))
          explain(
            'unknown-namespace',
            [],
            'The translation namespace cannot be narrowed to finite values.',
          )
        consume(argument, {
          ...info,
          namespaces: namespaces ?? (namespaceOption ? [...catalog.keys()] : info.namespaces),
        })
      }
    }
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      translationApi(node.tagName) === 'Trans'
    ) {
      currentSite = node
      const attributes = new Map<string, ts.Expression>()
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue
        const value = ts.isJsxExpression(attribute.initializer)
          ? attribute.initializer.expression
          : attribute.initializer
        if (value) attributes.set(attribute.name.getText(), value)
      }
      const key = attributes.get('i18nKey')
      if (attributes.has('ns') && !strings(attributes.get('ns')))
        explain('unknown-namespace', [], 'The Trans namespace cannot be narrowed to finite values.')
      if (key)
        consume(key, {
          namespaces:
            strings(attributes.get('ns')) ?? (attributes.has('ns') ? [...catalog.keys()] : ['app']),
          prefix: '',
          argument: 0,
        })
    }
    ts.forEachChild(node, visit)
  }
  for (const id of modules.keys()) {
    if (id.endsWith('.json')) continue
    currentModule = id
    const source = program.getSourceFile(fileNames.get(id)!)
    currentNamespaces = new Set<string>()
    moduleNamespaces.set(id, currentNamespaces)
    if (source) {
      const sourceImports = new Set(
        ts.preProcessFile(source.text, true, true).importedFiles.map((item) => item.fileName),
      )
      for (const [specifier, resolved] of resolutions.get(id) ?? []) {
        if (resolved !== null) continue
        currentSite =
          source.statements.find(
            (statement) =>
              ts.isImportDeclaration(statement) &&
              ts.isStringLiteral(statement.moduleSpecifier) &&
              statement.moduleSpecifier.text === specifier,
          ) ?? source
        explain(
          'unresolved-import',
          [],
          `Cannot trace runtime import ${specifier} after transforms; the original file was not used as a fallback.`,
          {
            specifier,
            kind: /\.(?:css|scss|sass|less|styl)(?:\?|$)|vite-rsc\/css/.test(specifier)
              ? 'style'
              : /\.(?:svg|png|jpe?g|webp|gif|ico|woff2?)(?:\?|$)/.test(specifier)
                ? 'asset'
                : specifier.startsWith('\0') || specifier.startsWith('virtual:')
                  ? 'virtual'
                  : specifier.includes('/node_modules/') ||
                      /^(?:@[^/]+\/[^/]+|[\w-]+)(?:\/|$)/.test(specifier)
                    ? 'package'
                    : 'source',
            origin: sourceImports.has(specifier) ? 'source' : 'generated',
          },
        )
      }
      visit(source)
    }
  }
  const unused: Record<string, string[]> = {}
  for (const [namespace, keys] of catalog) {
    if (protectedNamespaces.has(namespace)) continue
    const missing = [...keys].filter((key) => !used.get(namespace)?.has(key)).sort()
    if (missing.length) unused[namespace] = missing
  }
  return {
    unused,
    evidence: [...evidence.values()],
    timings: { programMs, analysisMs: performance.now() - analysisStarted },
    protectedNamespaces: [...protectedNamespaces].sort(),
    moduleCount: modules.size,
    moduleNamespaces,
  }
}
