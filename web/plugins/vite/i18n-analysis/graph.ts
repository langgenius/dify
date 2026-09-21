import type { TranslationAdapter } from './api'
import type { ModuleResolutions } from './compiler'
import path from 'node:path'
import * as ts from 'typescript'
import { createTranslationApiResolver } from './api'
import { camelCase, readTranslationCatalog } from './catalog'
import { createTranslationProgram, readCompilerOptions } from './compiler'

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
  kind: 'usage' | 'dynamic-key' | 'unresolved-import' | 'unknown-namespace'
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

export function createAnalysisContext(root: string, adapters: readonly TranslationAdapter[] = []) {
  return {
    adapters,
    translations: readTranslationCatalog(root),
    compilerOptions: readCompilerOptions(root),
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
  const { resolve: translationApi, isAdapter } = createTranslationApiResolver(
    root,
    program,
    context.adapters,
  )
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
    if (ts.isCallExpression(node)) return undefined
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
            if (api?.kind === 'translation' && api.selectorArgument === undefined) {
              const nsIndex = api.namespaceArgument
              return {
                namespaces:
                  (call.arguments[nsIndex] && namespaceStrings(call.arguments[nsIndex]!)) ??
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
    if (ts.isCallExpression(node)) return [{ text: '.*', wildcard: true }]
    if (ts.isIdentifier(node)) {
      const values = alternatives(node)
      if (
        values.some((value) => value !== node) &&
        values.some(
          (value) =>
            value && !ts.isFunctionDeclaration(value) && ts.isTemplateExpression(unwrap(value)),
        )
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
        record(value ? keyPatterns(value) : [{ text: '.*', wildcard: true }], info)
      }
    }
  }

  // Namespace values are deliberately narrower than key/type matching. Only
  // inline arrays and immutable string bindings are concrete loading evidence.
  function namespaceValues(
    expression: ts.Expression,
    seen = new Set<ts.Node>(),
    allowArray = true,
  ): { namespaces: string[]; unknown: boolean } {
    const unknown = { namespaces: [], unknown: true }
    const node = unwrap(expression)
    if (seen.has(node)) return unknown
    const next = new Set(seen).add(node)
    if (ts.isStringLiteralLike(node)) return { namespaces: [node.text], unknown: false }
    if (allowArray && ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map((element) => namespaceValues(element, next))
      return {
        namespaces: values.flatMap((value) => value.namespaces),
        unknown: values.some((value) => value.unknown),
      }
    }
    if (allowArray && ts.isSpreadElement(node)) return namespaceValues(node.expression, next)
    if (
      !ts.isIdentifier(node) &&
      !ts.isPropertyAccessExpression(node) &&
      !ts.isElementAccessExpression(node)
    )
      return unknown
    const values = declarations(node).filter(ts.isVariableDeclaration)
    if (!values.length) return unknown
    const resolved = values.map((declaration) =>
      ts.isVariableDeclarationList(declaration.parent) &&
      declaration.parent.flags & ts.NodeFlags.Const &&
      declaration.initializer
        ? namespaceValues(declaration.initializer, next, false)
        : unknown,
    )
    return {
      namespaces: resolved.flatMap((value) => value.namespaces),
      unknown: resolved.some((value) => value.unknown),
    }
  }
  function namespaceStrings(expression: ts.Expression): string[] {
    const { namespaces, unknown } = namespaceValues(expression)
    // Unknown values may select any catalog namespace. Preserve known values
    // outside the catalog too, so route validation still sees those requests.
    return unknown ? [...new Set([...namespaces, ...catalog.keys()])] : namespaces
  }
  function recordLoadedNamespaces(expression: ts.Expression): boolean {
    const { namespaces, unknown } = namespaceValues(expression)
    for (const namespace of namespaces) {
      currentNamespaces.add(namespace)
      explain('usage', [namespace], 'Explicit namespace load.')
    }
    return !unknown
  }

  function visit(node: ts.Node) {
    if (isAdapter(node)) return
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
      if (api?.kind === 'translation') {
        // Explicit loading requests matter even when their t function is unused.
        // Do not mark translation keys as used merely because a namespace loads.
        const nsIndex = api.namespaceArgument
        const argument = node.arguments[nsIndex]
        if (argument && !recordLoadedNamespaces(argument))
          explain(
            'unknown-namespace',
            [],
            'Only literal namespaces, inline arrays and const string bindings are resolved; runtime values remain unknown.',
          )
      }
      const info =
        api?.kind === 'translation' && api.selectorArgument !== undefined
          ? {
              namespaces: (node.arguments[api.namespaceArgument] &&
                namespaceStrings(node.arguments[api.namespaceArgument]!)) || [...catalog.keys()],
              prefix: '',
              argument: api.selectorArgument,
            }
          : translation(node.expression, node)
      const argument = info && node.arguments[info.argument]
      if (info && argument) {
        const options =
          api?.kind === 'translation' && api.selectorArgument !== undefined
            ? undefined
            : node.arguments.at(-1)
        const namespaceOption = property(options, 'ns')
        const namespaces = namespaceOption && namespaceStrings(namespaceOption)
        if (namespaceOption && namespaceValues(namespaceOption).unknown)
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
      translationApi(node.tagName)?.kind === 'trans'
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
      if (attributes.has('ns') && namespaceValues(attributes.get('ns')!).unknown)
        explain('unknown-namespace', [], 'The Trans namespace cannot be narrowed to finite values.')
      if (key)
        consume(key, {
          namespaces:
            (attributes.get('ns') && namespaceStrings(attributes.get('ns')!)) ??
            (attributes.has('ns') ? [...catalog.keys()] : ['app']),
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
        if (!resolved.diagnostic) continue
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
    moduleNamespaces,
  }
}
