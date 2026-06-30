import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

const DEFAULT_LOCALE = 'en-US'
const MAX_EXPANDED_VALUES = 200
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']
const SKIPPED_DIRECTORIES = new Set([
  '.next',
  '.turbo',
  '.vinext',
  '.vscode',
  'coverage',
  'dist',
  'i18n',
  'node_modules',
  'public',
])

type StaticValue
  = | { kind: 'strings', values: string[] }
    | { kind: 'object', properties: Map<string, StaticValue> }
    | { kind: 'array', elements: StaticValue[] }
    | { kind: 'identityFunction' }
    | { kind: 'unknown' }

type KeyExpressionUsage
  = | { kind: 'keys', keys: string[] }
    | { kind: 'patterns', patterns: Array<{ prefix: string, suffix: string }> }
    | { kind: 'mixed', keys: string[], patterns: Array<{ prefix: string, suffix: string }> }
    | { kind: 'unknown' }

type TranslationFunctionInfo = {
  namespaces: string[]
  keyPrefix?: string
}

type UsageLocation = {
  file: string
  line: number
  expression: string
}

export type DynamicKeyPattern = UsageLocation & {
  namespace: string
  prefix: string
  suffix: string
}

export type UnresolvedUsage = UsageLocation & {
  namespace?: string
  reason: string
}

type Catalog = {
  keysByNamespace: Map<string, Set<string>>
  fileNameByNamespace: Map<string, string>
  namespaceByFileName: Map<string, string>
}

export type AnalyzeUnusedTranslationsOptions = {
  webRoot?: string
  defaultLocale?: string
  files?: string[]
  sourceFiles?: string[]
}

export type AnalyzeUnusedTranslationsResult = {
  webRoot: string
  defaultLocale: string
  unusedKeysByNamespace: Record<string, string[]>
  usedKeysByNamespace: Record<string, string[]>
  allKeysByNamespace: Record<string, string[]>
  dynamicKeyPatterns: DynamicKeyPattern[]
  protectedNamespaces: string[]
  unresolvedUsages: UnresolvedUsage[]
  namespaceFiles: Record<string, string>
}

export type RemoveUnusedTranslationsOptions = {
  webRoot?: string
  locales?: string[]
  analysis: AnalyzeUnusedTranslationsResult
}

export type RemovedKey = {
  locale: string
  namespace: string
  key: string
}

export type RemoveUnusedTranslationsResult = {
  removedKeys: RemovedKey[]
}

// The analyzer keeps the pruning pipeline explicit: load the default catalog,
// collect statically provable usage, protect ambiguous dynamic usage, then prune.
type UsageCollector = {
  exactKeys: Map<string, Set<string>>
  patterns: DynamicKeyPattern[]
  protectedNamespaces: Set<string>
  unresolvedUsages: UnresolvedUsage[]
}

type Scope = {
  values: Map<string, StaticValue>
  translationFunctions: Map<string, TranslationFunctionInfo>
}

function toPosixPath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function fileNameToNamespace(fileName: string) {
  return fileName.replace(/[-_]+([a-z0-9])/gi, (_, char: string) => char.toUpperCase())
}

function namespaceToFileName(namespace: string, catalog: Catalog) {
  return catalog.fileNameByNamespace.get(namespace) ?? namespace.replace(/[A-Z0-9]/g, char => `-${char.toLowerCase()}`)
}

function isStringNode(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

function uniqueSorted(values: Iterable<string>) {
  return Array.from(new Set(values)).sort()
}

function normalizeNamespace(namespace: string, catalog: Catalog) {
  if (catalog.keysByNamespace.has(namespace))
    return namespace

  const fromFileName = catalog.namespaceByFileName.get(namespace)
  if (fromFileName)
    return fromFileName

  const camelNamespace = fileNameToNamespace(namespace)
  return catalog.keysByNamespace.has(camelNamespace) ? camelNamespace : namespace
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  let changed = true

  while (changed) {
    changed = false
    if (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isTypeAssertionExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression(current)
    ) {
      current = current.expression
      changed = true
    }
  }

  return current
}

function combineStringValues(left: string[], right: string[]) {
  const combined: string[] = []
  for (const leftValue of left) {
    for (const rightValue of right) {
      combined.push(`${leftValue}${rightValue}`)
      if (combined.length > MAX_EXPANDED_VALUES)
        return []
    }
  }
  return uniqueSorted(combined)
}

function staticStrings(values: string[]): StaticValue {
  return { kind: 'strings', values: uniqueSorted(values) }
}

function unknownStaticValue(): StaticValue {
  return { kind: 'unknown' }
}

function getPropertyNameText(name: ts.PropertyName) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text
  return undefined
}

function isFunctionLikeWithParameters(node: ts.Node): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.ConstructorDeclaration {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
}

function isLikelyTranslationFunctionType(typeNode: ts.TypeNode | undefined) {
  const typeText = typeNode?.getText()
  return Boolean(typeText && (/\bTFunction\b/.test(typeText) || /\buseTranslation\b/.test(typeText)))
}

function getTranslationFunctionInfoFromType(typeNode: ts.TypeNode | undefined, catalog: Catalog): TranslationFunctionInfo | undefined {
  if (!typeNode)
    return undefined

  if (ts.isTypeReferenceNode(typeNode) && /(?:^|\.)TFunction$/.test(typeNode.typeName.getText())) {
    const namespace = getStringLiteralTypeValue(typeNode.typeArguments?.[0])
    return {
      namespaces: namespace ? [normalizeNamespace(namespace, catalog)] : [],
      keyPrefix: undefined,
    }
  }

  if (isLikelyTranslationFunctionType(typeNode))
    return { namespaces: [], keyPrefix: undefined }

  return undefined
}

function addTranslationFunction(scope: Scope, name: string, info: TranslationFunctionInfo = { namespaces: [], keyPrefix: undefined }) {
  scope.translationFunctions.set(name, info)
}

function lookupValue(name: string, scopes: Scope[]) {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const value = scopes[index]!.values.get(name)
    if (value)
      return value
  }
  return undefined
}

function lookupTranslationFunction(name: string, scopes: Scope[]) {
  for (let index = scopes.length - 1; index >= 0; index--) {
    const value = scopes[index]!.translationFunctions.get(name)
    if (value)
      return value
  }
  return undefined
}

function evaluateStaticExpression(expression: ts.Expression, scopes: Scope[]): StaticValue {
  const unwrapped = unwrapExpression(expression)

  if (isStringNode(unwrapped))
    return staticStrings([unwrapped.text])

  if (ts.isTemplateExpression(unwrapped)) {
    let values = [unwrapped.head.text]
    for (const span of unwrapped.templateSpans) {
      const expressionValue = evaluateStaticExpression(span.expression, scopes)
      if (expressionValue.kind !== 'strings')
        return unknownStaticValue()

      values = combineStringValues(values, expressionValue.values)
      if (!values.length)
        return unknownStaticValue()

      values = values.map(value => `${value}${span.literal.text}`)
    }
    return staticStrings(values)
  }

  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluateStaticExpression(unwrapped.left, scopes)
    const right = evaluateStaticExpression(unwrapped.right, scopes)
    if (left.kind === 'strings' && right.kind === 'strings') {
      const values = combineStringValues(left.values, right.values)
      return values.length ? staticStrings(values) : unknownStaticValue()
    }
    return unknownStaticValue()
  }

  if (
    ts.isBinaryExpression(unwrapped)
    && (unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken || unwrapped.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    const left = evaluateStaticExpression(unwrapped.left, scopes)
    const right = evaluateStaticExpression(unwrapped.right, scopes)
    if (left.kind === 'strings' && right.kind === 'strings')
      return staticStrings([...left.values, ...right.values])
    return unknownStaticValue()
  }

  if (ts.isConditionalExpression(unwrapped)) {
    const whenTrue = evaluateStaticExpression(unwrapped.whenTrue, scopes)
    const whenFalse = evaluateStaticExpression(unwrapped.whenFalse, scopes)
    if (whenTrue.kind === 'strings' && whenFalse.kind === 'strings')
      return staticStrings([...whenTrue.values, ...whenFalse.values])
    return unknownStaticValue()
  }

  if (ts.isIdentifier(unwrapped))
    return lookupValue(unwrapped.text, scopes) ?? unknownStaticValue()

  if (ts.isPropertyAccessExpression(unwrapped)) {
    const container = evaluateStaticExpression(unwrapped.expression, scopes)
    if (container.kind === 'object')
      return container.properties.get(unwrapped.name.text) ?? unknownStaticValue()
    return unknownStaticValue()
  }

  if (ts.isElementAccessExpression(unwrapped) && unwrapped.argumentExpression) {
    const container = evaluateStaticExpression(unwrapped.expression, scopes)
    const argument = evaluateStaticExpression(unwrapped.argumentExpression, scopes)
    if (container.kind === 'object') {
      if (argument.kind !== 'strings') {
        const values = collectStringValues(container)
        return values.length ? staticStrings(values) : unknownStaticValue()
      }

      const values = argument.values.flatMap((key) => {
        const value = container.properties.get(key)
        return value ? collectStringValues(value) : []
      })
      return values.length ? staticStrings(values) : unknownStaticValue()
    }

    if (container.kind === 'array') {
      if (argument.kind !== 'strings') {
        const values = collectStringValues(container)
        return values.length ? staticStrings(values) : unknownStaticValue()
      }

      if (argument.values.length !== 1)
        return unknownStaticValue()

      const key = argument.values[0]!
      const index = Number(key)
      return Number.isInteger(index) ? container.elements[index] ?? unknownStaticValue() : unknownStaticValue()
    }
  }

  if (ts.isObjectLiteralExpression(unwrapped)) {
    const properties = new Map<string, StaticValue>()
    for (const property of unwrapped.properties) {
      if (!ts.isPropertyAssignment(property))
        continue

      const propertyName = getPropertyNameText(property.name)
      if (!propertyName)
        continue

      properties.set(propertyName, evaluateStaticExpression(property.initializer, scopes))
    }
    return { kind: 'object', properties }
  }

  if (ts.isArrayLiteralExpression(unwrapped))
    return { kind: 'array', elements: unwrapped.elements.map(element => evaluateStaticExpression(element, scopes)) }

  if (ts.isArrowFunction(unwrapped)) {
    const parameter = unwrapped.parameters[0]
    const body = ts.isBlock(unwrapped.body) ? undefined : unwrapExpression(unwrapped.body)
    if (
      parameter
      && ts.isIdentifier(parameter.name)
      && body
      && ts.isIdentifier(body)
      && body.text === parameter.name.text
    ) {
      return { kind: 'identityFunction' }
    }
  }

  if (ts.isCallExpression(unwrapped) && ts.isIdentifier(unwrapped.expression) && unwrapped.arguments.length === 1) {
    const callee = lookupValue(unwrapped.expression.text, scopes)
    if (callee?.kind === 'identityFunction')
      return evaluateStaticExpression(unwrapped.arguments[0]! as ts.Expression, scopes)
  }

  return unknownStaticValue()
}

function collectStringValues(value: StaticValue): string[] {
  if (value.kind === 'strings')
    return value.values

  if (value.kind === 'array')
    return uniqueSorted(value.elements.flatMap(element => collectStringValues(element)))

  if (value.kind === 'object')
    return uniqueSorted(Array.from(value.properties.values()).flatMap(property => collectStringValues(property)))

  return []
}

function getObjectProperty(objectLiteral: ts.ObjectLiteralExpression, name: string) {
  return objectLiteral.properties.find((property): property is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(property))
      return false
    const propertyName = getPropertyNameText(property.name)
    return propertyName === name
  })
}

function evaluateNamespaceExpression(expression: ts.Expression | undefined, scopes: Scope[], catalog: Catalog) {
  if (!expression)
    return []

  const value = evaluateStaticExpression(expression, scopes)
  if (value.kind === 'strings')
    return uniqueSorted(value.values.map(namespace => normalizeNamespace(namespace, catalog)))

  if (value.kind === 'array') {
    const namespaces: string[] = []
    for (const element of value.elements) {
      if (element.kind === 'strings')
        namespaces.push(...element.values.map(namespace => normalizeNamespace(namespace, catalog)))
    }
    return uniqueSorted(namespaces)
  }

  return []
}

function getStringLiteralTypeValue(typeNode: ts.TypeNode | undefined) {
  if (
    typeNode
    && ts.isLiteralTypeNode(typeNode)
    && ts.isStringLiteral(typeNode.literal)
  ) {
    return typeNode.literal.text
  }

  return undefined
}

function evaluateAssertedTypeKeyUsage(expression: ts.Expression): KeyExpressionUsage | undefined {
  const unwrapped = expression
  if (!ts.isAsExpression(unwrapped) && !ts.isTypeAssertionExpression(unwrapped))
    return undefined

  const literalValue = getStringLiteralTypeValue(unwrapped.type)
  if (literalValue)
    return { kind: 'keys', keys: [literalValue] }

  if (!ts.isTypeReferenceNode(unwrapped.type))
    return undefined

  const typeName = unwrapped.type.typeName.getText()
  if (typeName !== 'I18nKeysByPrefix' && typeName !== 'I18nKeysWithPrefix')
    return undefined

  const prefix = getStringLiteralTypeValue(unwrapped.type.typeArguments?.[1])
  if (!prefix)
    return undefined

  return {
    kind: 'patterns',
    patterns: [{ prefix, suffix: '' }],
  }
}

function extractStringValuesFromType(type: ts.Type, seen = new Set<ts.Type>()): string[] | undefined {
  if (seen.has(type))
    return undefined
  seen.add(type)

  if (type.isStringLiteral())
    return [type.value]

  if (type.isUnion()) {
    const values: string[] = []
    for (const subtype of type.types) {
      if (subtype.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void))
        continue

      const subtypeValues = extractStringValuesFromType(subtype, seen)
      if (!subtypeValues)
        return undefined

      values.push(...subtypeValues)
      if (values.length > MAX_EXPANDED_VALUES)
        return undefined
    }
    return values.length ? uniqueSorted(values) : undefined
  }

  return undefined
}

function evaluateCheckerKeyUsage(expression: ts.Expression, checker?: ts.TypeChecker): KeyExpressionUsage | undefined {
  if (!checker)
    return undefined

  const values = extractStringValuesFromType(checker.getTypeAtLocation(expression))
  if (!values?.length)
    return undefined

  return { kind: 'keys', keys: values }
}

function combineKeyExpressionUsages(left: KeyExpressionUsage, right: KeyExpressionUsage): KeyExpressionUsage {
  if (left.kind === 'unknown' || right.kind === 'unknown')
    return { kind: 'unknown' }

  const keys = [
    ...(left.kind === 'keys' || left.kind === 'mixed' ? left.keys : []),
    ...(right.kind === 'keys' || right.kind === 'mixed' ? right.keys : []),
  ]
  const patterns = [
    ...(left.kind === 'patterns' || left.kind === 'mixed' ? left.patterns : []),
    ...(right.kind === 'patterns' || right.kind === 'mixed' ? right.patterns : []),
  ]

  if (keys.length && patterns.length)
    return { kind: 'mixed', keys: uniqueSorted(keys), patterns }

  if (keys.length)
    return { kind: 'keys', keys: uniqueSorted(keys) }

  return { kind: 'patterns', patterns }
}

function evaluateKeyExpression(expression: ts.Expression, scopes: Scope[], checker?: ts.TypeChecker): KeyExpressionUsage {
  const value = evaluateStaticExpression(expression, scopes)
  if (value.kind === 'strings')
    return { kind: 'keys', keys: value.values }

  const assertedTypeUsage = evaluateAssertedTypeKeyUsage(expression)
  if (assertedTypeUsage)
    return assertedTypeUsage

  const checkerUsage = evaluateCheckerKeyUsage(expression, checker)
  if (checkerUsage)
    return checkerUsage

  const unwrapped = unwrapExpression(expression)
  if (ts.isConditionalExpression(unwrapped)) {
    return combineKeyExpressionUsages(
      evaluateKeyExpression(unwrapped.whenTrue, scopes, checker),
      evaluateKeyExpression(unwrapped.whenFalse, scopes, checker),
    )
  }

  if (!ts.isTemplateExpression(unwrapped))
    return { kind: 'unknown' }

  const spans = unwrapped.templateSpans
  const unknownIndexes = spans
    .map((span, index) => evaluateStaticExpression(span.expression, scopes).kind === 'strings' ? -1 : index)
    .filter(index => index >= 0)

  if (!unknownIndexes.length)
    return { kind: 'unknown' }

  const firstUnknownIndex = unknownIndexes[0]!
  const lastUnknownIndex = unknownIndexes.at(-1)!

  let prefixes = [unwrapped.head.text]
  for (let index = 0; index < firstUnknownIndex; index++) {
    const span = spans[index]!
    const spanValue = evaluateStaticExpression(span.expression, scopes)
    if (spanValue.kind !== 'strings')
      break

    prefixes = combineStringValues(prefixes, spanValue.values)
    if (!prefixes.length)
      return { kind: 'unknown' }

    prefixes = prefixes.map(prefix => `${prefix}${span.literal.text}`)
  }

  let suffixes = [spans[lastUnknownIndex]!.literal.text]
  for (let index = lastUnknownIndex + 1; index < spans.length; index++) {
    const span = spans[index]!
    const spanValue = evaluateStaticExpression(span.expression, scopes)
    if (spanValue.kind !== 'strings') {
      suffixes = ['']
    }
    else {
      suffixes = combineStringValues(suffixes, spanValue.values)
      if (!suffixes.length)
        suffixes = ['']
    }
    suffixes = suffixes.map(suffix => `${suffix}${span.literal.text}`)
  }

  return {
    kind: 'patterns',
    patterns: prefixes.flatMap(prefix => suffixes.map(suffix => ({ prefix, suffix }))),
  }
}

function prependKeyPrefix(usage: KeyExpressionUsage, keyPrefix?: string): KeyExpressionUsage {
  if (!keyPrefix)
    return usage

  const prefix = `${keyPrefix}.`
  if (usage.kind === 'keys')
    return { kind: 'keys', keys: usage.keys.map(key => `${prefix}${key}`) }

  if (usage.kind === 'patterns') {
    return {
      kind: 'patterns',
      patterns: usage.patterns.map(pattern => ({
        prefix: `${prefix}${pattern.prefix}`,
        suffix: pattern.suffix,
      })),
    }
  }

  return { kind: 'patterns', patterns: [{ prefix, suffix: '' }] }
}

function getLastOptionsObject(callExpression: ts.CallExpression) {
  for (let index = callExpression.arguments.length - 1; index >= 1; index--) {
    const argument = unwrapExpression(callExpression.arguments[index]! as ts.Expression)
    if (ts.isObjectLiteralExpression(argument))
      return argument
  }
  return undefined
}

function getUseTranslationInfo(callExpression: ts.CallExpression, scopes: Scope[], catalog: Catalog): TranslationFunctionInfo {
  const namespaces = evaluateNamespaceExpression(callExpression.arguments[0] as ts.Expression | undefined, scopes, catalog)
  const options = callExpression.arguments[1]
  const optionsObject = options ? unwrapExpression(options as ts.Expression) : undefined
  const keyPrefixProperty = optionsObject && ts.isObjectLiteralExpression(optionsObject)
    ? getObjectProperty(optionsObject, 'keyPrefix')
    : undefined
  const keyPrefixValue = keyPrefixProperty
    ? evaluateStaticExpression(keyPrefixProperty.initializer, scopes)
    : undefined

  return {
    namespaces,
    keyPrefix: keyPrefixValue?.kind === 'strings' && keyPrefixValue.values.length === 1
      ? keyPrefixValue.values[0]
      : undefined,
  }
}

function addExactKey(collector: UsageCollector, namespace: string, key: string, catalog: Catalog) {
  if (!collector.exactKeys.has(namespace))
    collector.exactKeys.set(namespace, new Set())

  const exactKeys = collector.exactKeys.get(namespace)!
  exactKeys.add(key)

  const namespaceKeys = catalog.keysByNamespace.get(namespace)
  if (!namespaceKeys)
    return

  for (const suffix of PLURAL_SUFFIXES) {
    const pluralKey = `${key}${suffix}`
    if (namespaceKeys.has(pluralKey))
      exactKeys.add(pluralKey)
  }
}

function addPattern(collector: UsageCollector, namespace: string, pattern: { prefix: string, suffix: string }, location: UsageLocation) {
  if (!pattern.prefix && !pattern.suffix) {
    collector.protectedNamespaces.add(namespace)
    return
  }

  collector.patterns.push({
    namespace,
    prefix: pattern.prefix,
    suffix: pattern.suffix,
    ...location,
  })
}

function splitNamespaceKey(key: string, catalog: Catalog) {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex <= 0)
    return undefined

  const namespace = normalizeNamespace(key.slice(0, separatorIndex), catalog)
  if (!catalog.keysByNamespace.has(namespace))
    return undefined

  return {
    namespace,
    key: key.slice(separatorIndex + 1),
  }
}

function inferNamespacesForKey(key: string, catalog: Catalog) {
  const namespaces: string[] = []
  for (const [namespace, keys] of catalog.keysByNamespace.entries()) {
    if (keys.has(key) || PLURAL_SUFFIXES.some(suffix => keys.has(`${key}${suffix}`)))
      namespaces.push(namespace)
  }
  return uniqueSorted(namespaces)
}

function patternMatchesKey(pattern: { prefix: string, suffix: string }, key: string) {
  return key.startsWith(pattern.prefix) && key.endsWith(pattern.suffix)
}

function inferNamespacesForPattern(pattern: { prefix: string, suffix: string }, catalog: Catalog) {
  const namespaces: string[] = []
  for (const [namespace, keys] of catalog.keysByNamespace.entries()) {
    if (Array.from(keys).some(key => patternMatchesKey(pattern, key)))
      namespaces.push(namespace)
  }
  return uniqueSorted(namespaces)
}

function locationFor(node: ts.Node, sourceFile: ts.SourceFile): UsageLocation {
  return {
    file: toPosixPath(path.relative(process.cwd(), sourceFile.fileName)),
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    expression: node.getText(sourceFile),
  }
}

function recordUnknownUsage(
  collector: UsageCollector,
  namespaces: string[],
  catalog: Catalog,
  location: UsageLocation,
  reason: string,
) {
  const targetNamespaces = namespaces.length ? namespaces : Array.from(catalog.keysByNamespace.keys())
  for (const namespace of targetNamespaces)
    collector.protectedNamespaces.add(namespace)

  collector.unresolvedUsages.push({
    ...location,
    namespace: namespaces.length === 1 ? namespaces[0] : undefined,
    reason,
  })
}

function recordKeyUsage(
  collector: UsageCollector,
  usage: KeyExpressionUsage,
  namespaces: string[],
  catalog: Catalog,
  location: UsageLocation,
) {
  if (usage.kind === 'unknown') {
    recordUnknownUsage(collector, namespaces, catalog, location, 'Unable to statically resolve translation key')
    return
  }

  if (usage.kind === 'keys' || usage.kind === 'mixed') {
    for (const rawKey of usage.keys) {
      const namespacedKey = splitNamespaceKey(rawKey, catalog)
      if (namespacedKey) {
        addExactKey(collector, namespacedKey.namespace, namespacedKey.key, catalog)
        continue
      }

      const targetNamespaces = namespaces.length ? namespaces : inferNamespacesForKey(rawKey, catalog)
      if (!targetNamespaces.length) {
        collector.unresolvedUsages.push({ ...location, reason: `No namespace contains key "${rawKey}"` })
        continue
      }

      for (const namespace of targetNamespaces)
        addExactKey(collector, namespace, rawKey, catalog)
    }
  }

  if (usage.kind === 'keys')
    return

  const patterns = usage.kind === 'mixed' ? usage.patterns : usage.patterns
  for (const rawPattern of patterns) {
    const namespacedPattern = splitNamespaceKey(rawPattern.prefix, catalog)
    if (namespacedPattern) {
      addPattern(collector, namespacedPattern.namespace, {
        prefix: namespacedPattern.key,
        suffix: rawPattern.suffix,
      }, location)
      continue
    }

    const targetNamespaces = namespaces.length ? namespaces : inferNamespacesForPattern(rawPattern, catalog)
    if (!targetNamespaces.length)
      continue

    for (const namespace of targetNamespaces)
      addPattern(collector, namespace, rawPattern, location)
  }
}

function getJsxAttribute(element: ts.JsxOpeningLikeElement, name: string) {
  return element.attributes.properties.find((property): property is ts.JsxAttribute => {
    return ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name
  })
}

function getJsxAttributeExpression(attribute: ts.JsxAttribute | undefined) {
  if (!attribute?.initializer)
    return undefined

  if (isStringNode(attribute.initializer))
    return attribute.initializer

  if (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression)
    return attribute.initializer.expression

  return undefined
}

function analyzeSourceFile(filePath: string, catalog: Catalog, collector: UsageCollector, checker?: ts.TypeChecker, sourceFileFromProgram?: ts.SourceFile) {
  const sourceFile = sourceFileFromProgram ?? (() => {
    const sourceText = fs.readFileSync(filePath, 'utf8')
    const scriptKind = filePath.endsWith('.tsx') || filePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
    return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, scriptKind)
  })()
  const scopes: Scope[] = [{ values: new Map(), translationFunctions: new Map() }]

  const withScope = (callback: () => void) => {
    scopes.push({ values: new Map(), translationFunctions: new Map() })
    callback()
    scopes.pop()
  }

  function visit(node: ts.Node) {
    if (isFunctionLikeWithParameters(node)) {
      withScope(() => {
        const currentScope = scopes.at(-1)!
        for (const parameter of node.parameters)
          handleFunctionParameter(parameter, currentScope)

        ts.forEachChild(node, visit)
      })
      return
    }

    if (ts.isBlock(node)) {
      withScope(() => ts.forEachChild(node, visit))
      return
    }

    if (ts.isImportDeclaration(node))
      handleImportDeclaration(node)

    if (ts.isVariableDeclaration(node)) {
      handleVariableDeclaration(node)
    }

    if (isStringNode(node))
      handleContextualI18nLiteral(node)

    if (ts.isCallExpression(node))
      handleCallExpression(node)

    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))
      handleJsxElement(node)

    ts.forEachChild(node, visit)
  }

  function handleImportDeclaration(node: ts.ImportDeclaration) {
    if (!ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== 'i18next')
      return

    const namedBindings = node.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings))
      return

    const currentScope = scopes.at(-1)!
    for (const element of namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text
      if (importedName === 't')
        addTranslationFunction(currentScope, element.name.text)
    }
  }

  function handleFunctionParameter(node: ts.ParameterDeclaration, scope: Scope) {
    const translationInfoFromType = getTranslationFunctionInfoFromType(node.type, catalog)
    if (ts.isIdentifier(node.name)) {
      if (node.name.text === 't' || translationInfoFromType)
        addTranslationFunction(scope, node.name.text, translationInfoFromType)
      return
    }

    if (!ts.isObjectBindingPattern(node.name))
      return

    for (const element of node.name.elements) {
      if (!ts.isIdentifier(element.name))
        continue

      const propertyName = element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : undefined
      if (propertyName === 't' || element.name.text === 't')
        addTranslationFunction(scope, element.name.text)
    }
  }

  function handleContextualI18nLiteral(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) {
    if (!checker || (!node.text.includes('.') && !node.text.includes(':')))
      return

    const contextualType = checker.getContextualType(node)
    if (!contextualType)
      return

    const contextualKeys = extractStringValuesFromType(contextualType)
    if (!contextualKeys?.includes(node.text))
      return

    recordKeyUsage(collector, { kind: 'keys', keys: [node.text] }, [], catalog, locationFor(node, sourceFile))
  }

  function handleVariableDeclaration(node: ts.VariableDeclaration) {
    if (!node.initializer)
      return

    const currentScope = scopes.at(-1)!
    if (ts.isIdentifier(node.name))
      currentScope.values.set(node.name.text, evaluateStaticExpression(node.initializer, scopes))

    if (!ts.isObjectBindingPattern(node.name))
      return

    const initializer = unwrapExpression(node.initializer)
    const callExpression = ts.isAwaitExpression(initializer)
      ? unwrapExpression(initializer.expression)
      : initializer

    if (!ts.isCallExpression(callExpression) || !ts.isIdentifier(callExpression.expression))
      return

    const calleeName = callExpression.expression.text
    if (calleeName !== 'useTranslation' && calleeName !== 'getTranslation')
      return

    const translationInfo = calleeName === 'useTranslation'
      ? getUseTranslationInfo(callExpression, scopes, catalog)
      : {
          namespaces: evaluateNamespaceExpression(callExpression.arguments[1] as ts.Expression | undefined, scopes, catalog),
          keyPrefix: undefined,
        }

    for (const element of node.name.elements) {
      const propertyName = element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : ts.isIdentifier(element.name) ? element.name.text : undefined
      if (propertyName !== 't' || !ts.isIdentifier(element.name))
        continue

      currentScope.translationFunctions.set(element.name.text, translationInfo)
    }
  }

  function handleCallExpression(node: ts.CallExpression) {
    const translationInfo = ts.isIdentifier(node.expression)
      ? lookupTranslationFunction(node.expression.text, scopes)
      : ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'
        ? { namespaces: [], keyPrefix: undefined }
        : undefined
    if (!translationInfo || !node.arguments.length)
      return

    const options = getLastOptionsObject(node)
    const namespaceProperty = options ? getObjectProperty(options, 'ns') : undefined
    const optionNamespaces = namespaceProperty
      ? evaluateNamespaceExpression(namespaceProperty.initializer, scopes, catalog)
      : []
    const namespaces = optionNamespaces.length ? optionNamespaces : translationInfo.namespaces
    const keyExpression = node.arguments[0]! as ts.Expression
    const keyUsage = prependKeyPrefix(evaluateKeyExpression(keyExpression, scopes, checker), translationInfo.keyPrefix)

    recordKeyUsage(collector, keyUsage, namespaces, catalog, locationFor(node, sourceFile))
  }

  function handleJsxElement(node: ts.JsxOpeningLikeElement) {
    if (node.tagName.getText(sourceFile) !== 'Trans')
      return

    const keyExpression = getJsxAttributeExpression(getJsxAttribute(node, 'i18nKey'))
    if (!keyExpression)
      return

    const namespaceExpression = getJsxAttributeExpression(getJsxAttribute(node, 'ns'))
    const namespaces = evaluateNamespaceExpression(namespaceExpression, scopes, catalog)
    const keyUsage = evaluateKeyExpression(keyExpression, scopes, checker)

    recordKeyUsage(collector, keyUsage, namespaces, catalog, locationFor(node, sourceFile))
  }

  visit(sourceFile)
}

function getCatalog(webRoot: string, defaultLocale: string, targetFiles: string[] = []): Catalog {
  const localeDir = path.join(webRoot, 'i18n', defaultLocale)
  const targetFileNames = new Set(targetFiles.map(file => file.replace(/\.json$/, '')))
  const targetNamespaces = new Set(targetFiles.map(file => fileNameToNamespace(file.replace(/\.json$/, ''))))
  const keysByNamespace = new Map<string, Set<string>>()
  const fileNameByNamespace = new Map<string, string>()
  const namespaceByFileName = new Map<string, string>()

  for (const file of fs.readdirSync(localeDir).filter(file => file.endsWith('.json')).sort()) {
    const fileName = file.replace(/\.json$/, '')
    const namespace = fileNameToNamespace(fileName)
    if (targetFiles.length && !targetFileNames.has(fileName) && !targetNamespaces.has(namespace))
      continue

    const content = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8')) as Record<string, unknown>
    keysByNamespace.set(namespace, new Set(Object.keys(content)))
    fileNameByNamespace.set(namespace, fileName)
    namespaceByFileName.set(fileName, namespace)
  }

  return { keysByNamespace, fileNameByNamespace, namespaceByFileName }
}

function listSourceFiles(webRoot: string, explicitSourceFiles?: string[]) {
  if (explicitSourceFiles?.length)
    return explicitSourceFiles.map(file => path.isAbsolute(file) ? file : path.join(webRoot, file))

  const sourceFiles: string[] = []
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name))
          walk(path.join(directory, entry.name))
        continue
      }

      if (!entry.isFile())
        continue

      const filePath = path.join(directory, entry.name)
      if (filePath.endsWith('.d.ts'))
        continue

      if (SOURCE_EXTENSIONS.has(path.extname(entry.name)))
        sourceFiles.push(filePath)
    }
  }

  walk(webRoot)
  return sourceFiles.sort()
}

function mapToRecord(map: Map<string, Set<string>>) {
  const record: Record<string, string[]> = {}
  for (const [namespace, values] of map.entries()) {
    const sortedValues = uniqueSorted(values)
    if (sortedValues.length)
      record[namespace] = sortedValues
  }
  return record
}

function createTypeChecker(webRoot: string, sourceFiles: string[]) {
  try {
    const configPath = ts.findConfigFile(webRoot, ts.sys.fileExists, 'tsconfig.json')
    const config = configPath
      ? ts.readConfigFile(configPath, ts.sys.readFile)
      : undefined
    const parsedConfig = configPath && config && !config.error
      ? ts.parseJsonConfigFileContent(config.config, ts.sys, webRoot)
      : undefined

    const compilerOptions: ts.CompilerOptions = {
      ...(parsedConfig?.options ?? {}),
      allowJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      noEmit: true,
      skipLibCheck: true,
    }

    const program = ts.createProgram({
      rootNames: sourceFiles,
      options: compilerOptions,
    })

    return {
      checker: program.getTypeChecker(),
      sourceFileByPath: new Map(program.getSourceFiles().map(sourceFile => [path.resolve(sourceFile.fileName), sourceFile])),
    }
  }
  catch {
    return undefined
  }
}

export async function analyzeUnusedTranslations(options: AnalyzeUnusedTranslationsOptions = {}): Promise<AnalyzeUnusedTranslationsResult> {
  const webRoot = options.webRoot ?? path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const defaultLocale = options.defaultLocale ?? DEFAULT_LOCALE
  const catalog = getCatalog(webRoot, defaultLocale, options.files)
  const sourceFiles = listSourceFiles(webRoot, options.sourceFiles)
  const typeChecker = createTypeChecker(webRoot, sourceFiles)
  const collector: UsageCollector = {
    exactKeys: new Map(),
    patterns: [],
    protectedNamespaces: new Set(),
    unresolvedUsages: [],
  }

  for (const file of sourceFiles)
    analyzeSourceFile(file, catalog, collector, typeChecker?.checker, typeChecker?.sourceFileByPath.get(path.resolve(file)))

  const unusedKeys = new Map<string, Set<string>>()
  for (const [namespace, keys] of catalog.keysByNamespace.entries()) {
    if (collector.protectedNamespaces.has(namespace))
      continue

    const exactKeys = collector.exactKeys.get(namespace) ?? new Set<string>()
    const patterns = collector.patterns.filter(pattern => pattern.namespace === namespace)
    for (const key of keys) {
      if (exactKeys.has(key) || patterns.some(pattern => patternMatchesKey(pattern, key)))
        continue

      if (!unusedKeys.has(namespace))
        unusedKeys.set(namespace, new Set())
      unusedKeys.get(namespace)!.add(key)
    }
  }

  return {
    webRoot,
    defaultLocale,
    unusedKeysByNamespace: mapToRecord(unusedKeys),
    usedKeysByNamespace: mapToRecord(collector.exactKeys),
    allKeysByNamespace: mapToRecord(catalog.keysByNamespace),
    dynamicKeyPatterns: collector.patterns.sort((left, right) => {
      return `${left.namespace}:${left.prefix}:${left.suffix}`.localeCompare(`${right.namespace}:${right.prefix}:${right.suffix}`)
    }),
    protectedNamespaces: uniqueSorted(collector.protectedNamespaces),
    unresolvedUsages: collector.unresolvedUsages,
    namespaceFiles: Object.fromEntries(catalog.fileNameByNamespace.entries()),
  }
}

function listLocales(webRoot: string) {
  return fs.readdirSync(path.join(webRoot, 'i18n'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
}

export async function removeUnusedTranslations(options: RemoveUnusedTranslationsOptions): Promise<RemoveUnusedTranslationsResult> {
  const webRoot = options.webRoot ?? options.analysis.webRoot
  const locales = options.locales?.length ? options.locales : listLocales(webRoot)
  const removedKeys: RemovedKey[] = []

  for (const locale of locales) {
    for (const [namespace, keys] of Object.entries(options.analysis.unusedKeysByNamespace).sort()) {
      const fileName = options.analysis.namespaceFiles[namespace] ?? namespaceToFileName(namespace, {
        keysByNamespace: new Map(),
        fileNameByNamespace: new Map(Object.entries(options.analysis.namespaceFiles).map(([ns, file]) => [ns, file])),
        namespaceByFileName: new Map(),
      })
      const filePath = path.join(webRoot, 'i18n', locale, `${fileName}.json`)
      if (!fs.existsSync(filePath))
        continue

      const content = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>
      let modified = false
      for (const key of keys) {
        if (!(key in content))
          continue

        delete content[key]
        modified = true
        removedKeys.push({ locale, namespace, key })
      }

      if (modified)
        fs.writeFileSync(filePath, `${JSON.stringify(content, null, 2)}\n`, 'utf8')
    }
  }

  return { removedKeys }
}
