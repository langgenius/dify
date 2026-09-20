import fs from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'

const PLURAL = /_(?:zero|one|two|few|many|other)$/
const MAX_VALUES = 200
const camelCase = (name: string) =>
  name.replace(/[-_]+([a-z0-9])/gi, (_, char: string) => char.toUpperCase())
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

// Only module IDs supplied by Vite are visited. Type dependencies inform static
// expressions but never contribute usage merely by existing on disk.
export function checkTranslationGraph(root: string, modules: ReadonlyMap<string, string>) {
  const catalog = new Map<string, Set<string>>()
  const directory = path.join(root, 'i18n/locales/en-US')
  for (const file of fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .sort()) {
    const content: unknown = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))
    if (!content || typeof content !== 'object' || Array.isArray(content))
      throw new Error(`Invalid translation catalog: ${file}`)
    catalog.set(camelCase(file.slice(0, -5)), new Set(Object.keys(content)))
  }
  const configPath = ts.findConfigFile(root, ts.sys.fileExists)
  const config = configPath ? ts.readConfigFile(configPath, ts.sys.readFile) : undefined
  if (config?.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const options =
    configPath && config
      ? ts.parseJsonConfigFileContent(
          config.config,
          { ...ts.sys, readDirectory: () => [] },
          path.dirname(configPath),
        ).options
      : {}
  const compilerOptions: ts.CompilerOptions = {
    ...options,
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    skipLibCheck: true,
  }
  const host = ts.createCompilerHost(compilerOptions)
  const readFile = host.readFile.bind(host)
  host.readFile = (file) => modules.get(file) ?? readFile(file)
  const fileExists = host.fileExists.bind(host)
  host.fileExists = (file) => modules.has(file) || fileExists(file)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = modules.get(file)
    return source === undefined
      ? getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(file, source, languageVersion, true)
  }
  const program = ts.createProgram([...modules.keys()], compilerOptions, host)
  const checker = program.getTypeChecker()
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
            const name = call.expression.getText()
            if (/(?:^|\.)(?:useTranslation|getTranslation)$/.test(name)) {
              const nsIndex = name.endsWith('getTranslation') ? 1 : 0
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
    if (ts.isCallExpression(node)) {
      const values = alternatives(node)
      if (values.some((value) => value !== node)) {
        return values.flatMap((value) =>
          value && !ts.isFunctionDeclaration(value)
            ? keyPatterns(value)
            : [{ text: '.*', wildcard: true }],
        )
      }
    }
    const values = strings(expression)
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
          continue
        }
        const prefix = info.prefix ? `${info.prefix}.` : ''
        const pattern = key.wildcard ? new RegExp(`^${escapeRegex(prefix)}${text}$`) : undefined
        const matches = (candidate: string) =>
          pattern ? pattern.test(candidate) : candidate === prefix + text
        const kept = used.get(namespace) ?? new Set<string>()
        for (const candidate of catalog.get(namespace)!) {
          if (matches(candidate) || matches(candidate.replace(PLURAL, ''))) kept.add(candidate)
        }
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

  function visit(node: ts.Node) {
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
      const info = translation(node.expression, node)
      const argument = info && node.arguments[info.argument]
      if (info && argument) {
        const options = node.arguments.at(-1)
        const namespaceOption = property(options, 'ns')
        const namespaces = strings(namespaceOption)
        consume(argument, {
          ...info,
          namespaces: namespaces ?? (namespaceOption ? [...catalog.keys()] : info.namespaces),
        })
      }
    }
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      node.tagName.getText() === 'Trans'
    ) {
      const attributes = new Map<string, ts.Expression>()
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue
        const value = ts.isJsxExpression(attribute.initializer)
          ? attribute.initializer.expression
          : attribute.initializer
        if (value) attributes.set(attribute.name.getText(), value)
      }
      const key = attributes.get('i18nKey')
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
    const source = program.getSourceFile(id)
    currentNamespaces = new Set<string>()
    moduleNamespaces.set(id, currentNamespaces)
    if (source) visit(source)
  }
  const unused: Record<string, string[]> = {}
  for (const [namespace, keys] of catalog) {
    if (protectedNamespaces.has(namespace)) continue
    const missing = [...keys].filter((key) => !used.get(namespace)?.has(key)).sort()
    if (missing.length) unused[namespace] = missing
  }
  return {
    unused,
    protectedNamespaces: [...protectedNamespaces].sort(),
    moduleCount: modules.size,
    moduleNamespaces,
  }
}
