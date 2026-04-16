import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
export const SUPPORTED_DIAGNOSTIC_CODES = new Set([2322, 2339, 2345, 2488, 2532, 2538, 2604, 2722, 2769, 2786, 7006, 18047, 18048])
const DEFAULT_MAX_ITERATIONS = 10
const ACCESS_DIAGNOSTIC_CODES = new Set([2339, 2532, 18047, 18048])
const ASSIGNABILITY_DIAGNOSTIC_CODES = new Set([2322, 2345, 2769])
const parsedConfigCache = new Map<string, ts.ParsedCommandLine>()

type CliOptions = {
  files: string[]
  maxIterations: number
  project: string
  useFullProjectRoots?: boolean
  verbose: boolean
  write: boolean
}

type TextEdit = {
  end: number
  expectedText?: string
  replacement: string
  start: number
}

type EditTarget
  = { expression: ts.Expression, kind: 'expression', sourceFile: ts.SourceFile }
    | { end: number, kind: 'direct-edit', replacement: string, sourceFile: ts.SourceFile, start: number }
    | { kind: 'shorthand-property', property: ts.ShorthandPropertyAssignment, sourceFile: ts.SourceFile }

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    files: [],
    maxIterations: DEFAULT_MAX_ITERATIONS,
    project: 'tsconfig.json',
    verbose: false,
    write: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg)
      continue

    if (arg === '--')
      continue

    if (arg === '--write') {
      options.write = true
      continue
    }

    if (arg === '--verbose') {
      options.verbose = true
      continue
    }

    if (arg === '--project') {
      const value = argv[i + 1]
      if (!value)
        throw new Error('Missing value for --project')

      options.project = value
      i += 1
      continue
    }

    if (arg === '--max-iterations') {
      const value = argv[i + 1]
      if (!value)
        throw new Error('Missing value for --max-iterations')

      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed <= 0)
        throw new Error(`Invalid --max-iterations value: ${value}`)

      options.maxIterations = parsed
      i += 1
      continue
    }

    if (arg === '--files') {
      const value = argv[i + 1]
      if (!value)
        throw new Error('Missing value for --files')

      options.files.push(...splitFilesArgument(value))
      i += 1
      continue
    }

    if (arg.startsWith('--'))
      throw new Error(`Unknown option: ${arg}`)

    options.files.push(...splitFilesArgument(arg))
  }

  return options
}

function splitFilesArgument(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function parseTsConfig(projectPath: string): ts.ParsedCommandLine {
  const cached = parsedConfigCache.get(projectPath)
  if (cached)
    return cached

  const configFile = ts.readConfigFile(projectPath, ts.sys.readFile)
  if (configFile.error)
    throw new Error(formatDiagnostic(configFile.error))

  const configDirectory = path.dirname(projectPath)
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    configDirectory,
    undefined,
    projectPath,
  )
  parsedConfigCache.set(projectPath, parsedConfig)
  return parsedConfig
}

function createMigrationProgram(
  rootNames: string[],
  parsedConfig: ts.ParsedCommandLine,
  fileTexts: Map<string, string>,
  oldProgram?: ts.Program,
): ts.Program {
  const compilerHost = ts.createCompilerHost(parsedConfig.options, true)
  const originalGetSourceFile = compilerHost.getSourceFile.bind(compilerHost)

  compilerHost.readFile = (fileName) => {
    return fileTexts.get(fileName) ?? ts.sys.readFile(fileName)
  }

  compilerHost.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const text = fileTexts.get(fileName)
    if (text !== undefined)
      return ts.createSourceFile(fileName, text, languageVersion, true)

    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
  }

  return ts.createProgram({
    oldProgram,
    host: compilerHost,
    options: parsedConfig.options,
    projectReferences: parsedConfig.projectReferences,
    rootNames,
  })
}

function isTargetFile(fileName: string): boolean {
  const extension = path.extname(fileName)
  if (!SUPPORTED_EXTENSIONS.has(extension))
    return false

  if (fileName.endsWith('.d.ts'))
    return false

  return !fileName.includes(`${path.sep}.next${path.sep}`)
}

function normalizeFileName(fileName: string): string {
  return path.resolve(fileName)
}

function isDeclarationSupportFile(fileName: string): boolean {
  return fileName.endsWith('.d.ts')
}

function isSetupSupportFile(fileName: string): boolean {
  const baseName = path.basename(fileName)
  return baseName === 'vitest.setup.ts'
    || baseName === 'vitest.setup.tsx'
    || baseName === 'jest.setup.ts'
    || baseName === 'jest.setup.tsx'
    || baseName === 'setupTests.ts'
    || baseName === 'setupTests.tsx'
    || baseName === 'test.setup.ts'
    || baseName === 'test.setup.tsx'
}

function getMigrationRootNames(
  parsedConfig: ts.ParsedCommandLine,
  targetFiles: string[],
): string[] {
  const rootNames = new Set(targetFiles)

  for (const fileName of parsedConfig.fileNames.map(normalizeFileName)) {
    if (isDeclarationSupportFile(fileName) || isSetupSupportFile(fileName))
      rootNames.add(fileName)
  }

  return Array.from(rootNames)
}

function createFileMatcher(filePatterns: string[]): (fileName: string) => boolean {
  if (filePatterns.length === 0)
    return () => true

  const patterns = filePatterns.map(pattern => ({
    absolute: normalizeFileName(pattern),
    raw: pattern.split(path.sep).join('/'),
  }))
  return (fileName: string) => {
    const normalized = normalizeFileName(fileName)
    const unixStyle = normalized.split(path.sep).join('/')
    return patterns.some(pattern => normalized === pattern.absolute || unixStyle.endsWith(pattern.raw))
  }
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  if (!diagnostic.file || diagnostic.start === undefined)
    return message

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${message}`
}

function ensureTrailingNonNullAssertion(expression: string): string {
  const trimmedExpression = expression.trimEnd()
  return trimmedExpression.endsWith('!')
    ? trimmedExpression
    : `${trimmedExpression}!`
}

function hasOptionalChainDescendant(node: ts.Node): boolean {
  let found = false

  const visit = (current: ts.Node) => {
    if (found)
      return

    if (ts.isOptionalChain(current)) {
      found = true
      return
    }

    current.forEachChild(visit)
  }

  visit(node)
  return found
}

function shouldPrintInlineNonNullAssertion(expression: ts.Expression): boolean {
  return ts.isOptionalChain(expression)
    || (ts.isParenthesizedExpression(expression) && hasOptionalChainDescendant(expression.expression))
}

function normalizeOptionalChainNonNullContinuations(text: string): string {
  const sourceFile = ts.createSourceFile('normalize.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits: TextEdit[] = []

  const visit = (node: ts.Node) => {
    if (
      ts.isNonNullExpression(node)
      && ts.isParenthesizedExpression(node.expression)
      && hasOptionalChainDescendant(node.expression.expression)
    ) {
      edits.push({
        end: node.getEnd(),
        replacement: `${node.expression.expression.getText(sourceFile)}!`,
        start: node.getStart(sourceFile),
      })
      return
    }

    node.forEachChild(visit)
  }

  visit(sourceFile)

  if (edits.length === 0)
    return text

  return applyEdits(text, edits).text
}

function collapseRepeatedInlineComments(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const commentIndex = line.indexOf('//')
      if (commentIndex < 0)
        return line

      const prefix = line.slice(0, commentIndex).trimEnd()
      const comment = line.slice(commentIndex + 2).trim()
      const segments = comment
        .split(/\s+\/\/\s+/)
        .map(item => item.trim())
        .filter(Boolean)

      if (segments.length < 2)
        return line

      const lastSegment = segments[segments.length - 1]!
      const stableSegments = segments.slice(0, -1)
      const repeatedSameComment = stableSegments.length > 0
        && stableSegments.every(segment => segment === segments[0])
        && (lastSegment === segments[0] || segments[0]!.startsWith(lastSegment) || lastSegment.startsWith(segments[0]!))

      if (!repeatedSameComment)
        return line.replace(/!{2,}$/g, '!')

      const normalizedComment = segments[0]!.replace(/!{2,}$/g, '!')
      return prefix ? `${prefix} // ${normalizedComment}` : `// ${normalizedComment}`
    })
    .join('\n')
}

export function normalizeMalformedAssertions(text: string): string {
  const normalizedText = text
    .replace(/\n(\s*)! (\s*\/\/[^\n]*)\n/g, '! $2\n')
    .replace(/\.not!+(?=[.(])/g, '.not')
    .replace(/(\(|,\s*)([A-Za-z_$][\w$]*)\s*:\s*any\s*=>/g, '$1($2: any) =>')
    .replace(/([,{]\s*)([A-Z_$][\w$]*)!=\{/g, '$1$2={')
    .replace(/\b([A-Z_$][\w$]*)!!,/gi, '$1: $1!,')
    .replace(/\b([A-Z_$][\w$]*)!!:/gi, '$1:')
    .replace(/([,{]\s*)([A-Z_$][\w$]*)!:/gi, '$1$2:')
    .replace(/\b(const|let|var)\s+\{([^=\n]+)\}\s*=\s*([^\n;]+)/g, (fullMatch, keyword: string, bindings: string, expression: string) => {
      if (!bindings.includes('!'))
        return fullMatch

      const normalizedBindings = bindings.replace(/!([,\s}:])/g, '$1')
      return `${keyword} {${normalizedBindings}} = ${ensureTrailingNonNullAssertion(expression)}`
    })

  return collapseRepeatedInlineComments(normalizeOptionalChainNonNullContinuations(normalizedText))
}

function isExpressionTarget(target: EditTarget): target is Extract<EditTarget, { kind: 'expression' }> {
  return target.kind === 'expression'
}

function createExpressionTarget(expression: ts.Expression): EditTarget {
  return {
    expression,
    kind: 'expression',
    sourceFile: expression.getSourceFile(),
  }
}

function createShorthandPropertyTarget(property: ts.ShorthandPropertyAssignment): EditTarget {
  return {
    kind: 'shorthand-property',
    property,
    sourceFile: property.getSourceFile(),
  }
}

function createDirectEditTarget(
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
  replacement: string,
): EditTarget {
  return {
    end,
    kind: 'direct-edit',
    replacement,
    sourceFile,
    start,
  }
}

function createIterableFallbackReplacement(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string {
  return `(${expression.getText(sourceFile)} ?? [])`
}

function createIterableFallbackTarget(expression: ts.Expression): EditTarget {
  return createDirectEditTarget(
    expression.getSourceFile(),
    expression.getStart(expression.getSourceFile()),
    expression.getEnd(),
    createIterableFallbackReplacement(expression, expression.getSourceFile()),
  )
}

function createArrayLiteralIterableFallbackTarget(
  arrayLiteral: ts.ArrayLiteralExpression,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const sourceFile = arrayLiteral.getSourceFile()
  const start = arrayLiteral.getStart(sourceFile)
  const end = arrayLiteral.getEnd()
  const originalText = sourceFile.text.slice(start, end)
  const edits: TextEdit[] = []

  for (const element of arrayLiteral.elements) {
    if (!ts.isSpreadElement(element))
      continue

    if (isAlreadyNonNull(element.expression))
      continue

    if (!typeIncludesUndefined(checker.getTypeAtLocation(element.expression)))
      continue

    edits.push({
      end: element.expression.getEnd() - start,
      replacement: createIterableFallbackReplacement(element.expression, sourceFile),
      start: element.expression.getStart(sourceFile) - start,
    })
  }

  if (edits.length === 0)
    return undefined

  return createDirectEditTarget(
    sourceFile,
    start,
    end,
    applyEdits(originalText, edits).text,
  )
}

function getTokenAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node {
  let current: ts.Node = sourceFile

  while (true) {
    let next: ts.Node | undefined
    current.forEachChild((child) => {
      if (!next && position >= child.getFullStart() && position < child.getEnd())
        next = child
    })

    if (!next)
      return current

    current = next
  }
}

function findAncestor<NodeType extends ts.Node>(
  node: ts.Node | undefined,
  predicate: (candidate: ts.Node) => candidate is NodeType,
): NodeType | undefined {
  let current = node

  while (current) {
    if (predicate(current))
      return current

    current = current.parent
  }

  return undefined
}

function findTightestExpression(sourceFile: ts.SourceFile, start: number, end: number): ts.Expression | undefined {
  let node: ts.Node | undefined = getTokenAtPosition(sourceFile, start)

  while (node) {
    if (ts.isExpression(node)) {
      const nodeStart = node.getStart(sourceFile)
      const nodeEnd = node.getEnd()
      if (nodeStart <= start && end <= nodeEnd)
        return node
    }

    node = node.parent
  }

  return undefined
}

function isAssignmentOperator(token: ts.SyntaxKind): boolean {
  return token >= ts.SyntaxKind.FirstAssignment && token <= ts.SyntaxKind.LastAssignment
}

function typeIncludesUndefined(type: ts.Type): boolean {
  if ((type.flags & ts.TypeFlags.Undefined) !== 0)
    return true

  if (!type.isUnion())
    return false

  return type.types.some(typeIncludesUndefined)
}

function skipOuterExpressions(expression: ts.Expression): ts.Expression {
  let current = expression

  while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current))
    current = current.expression

  return current
}

function isAlreadyNonNull(expression: ts.Expression): boolean {
  let current = expression

  while (ts.isParenthesizedExpression(current))
    current = current.expression

  return ts.isNonNullExpression(current)
}

function findAssignmentLikeCandidate(
  token: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): ts.Expression | undefined {
  let current: ts.Node | undefined = token

  while (current) {
    if (ts.isVariableDeclaration(current) && current.initializer)
      return current.initializer

    if (ts.isPropertyDeclaration(current) && current.initializer)
      return current.initializer

    if (ts.isPropertyAssignment(current))
      return current.initializer

    if (ts.isShorthandPropertyAssignment(current))
      return current.name

    if (ts.isParameter(current) && current.initializer)
      return current.initializer

    if (ts.isReturnStatement(current) && current.expression)
      return current.expression

    if (ts.isBinaryExpression(current) && isAssignmentOperator(current.operatorToken.kind))
      return current.right

    if (ts.isJsxAttribute(current) && current.initializer && ts.isJsxExpression(current.initializer) && current.initializer.expression)
      return current.initializer.expression

    if (ts.isJsxSpreadAttribute(current))
      return current.expression

    current = current.parent
  }

  return findTightestExpression(sourceFile, start, end)
}

function findArgumentCandidate(
  token: ts.Node,
  sourceFile: ts.SourceFile,
  start: number,
  end: number,
): ts.Expression | undefined {
  let current: ts.Node | undefined = token

  while (current) {
    if ((ts.isCallExpression(current) || ts.isNewExpression(current)) && current.arguments) {
      const argument = current.arguments.find((item) => {
        const itemStart = item.getStart(sourceFile)
        const itemEnd = item.getEnd()
        return itemStart <= start && end <= itemEnd
      })
      if (argument)
        return argument
    }

    current = current.parent
  }

  return findTightestExpression(sourceFile, start, end)
}

function getExpressionFromJsxAttribute(attribute: ts.JsxAttribute): ts.Expression | undefined {
  return attribute.initializer && ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined
}

function findTargetFromExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const referencedDeclarationTarget = findReferencedDeclarationInitializerTarget(expression, checker)
  if (referencedDeclarationTarget)
    return referencedDeclarationTarget

  const nestedTarget = findNestedContainerTarget(expression, checker)
  if (nestedTarget)
    return nestedTarget

  const innerExpression = skipOuterExpressions(expression)
  if (ts.isConditionalExpression(innerExpression)) {
    return findTargetFromExpression(innerExpression.whenTrue, checker)
      ?? findTargetFromExpression(innerExpression.whenFalse, checker)
  }

  if (
    ts.isBinaryExpression(innerExpression)
    && (
      innerExpression.operatorToken.kind === ts.SyntaxKind.BarBarToken
      || innerExpression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      || innerExpression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
    )
  ) {
    return findTargetFromExpression(innerExpression.left, checker)
      ?? findTargetFromExpression(innerExpression.right, checker)
  }

  if (ts.isArrowFunction(innerExpression) || ts.isFunctionExpression(innerExpression)) {
    const functionTarget = findFunctionLikeReturnTarget(innerExpression, checker)
    if (functionTarget)
      return functionTarget
  }

  if (ts.isPropertyAccessExpression(innerExpression)) {
    const namedPropertyTarget = findNamedPropertyTarget(innerExpression.expression, innerExpression.name.text, checker)
    if (namedPropertyTarget)
      return namedPropertyTarget
  }

  if (ts.isCallExpression(innerExpression)) {
    const collectionCallbackTarget = findCollectionCallbackTarget(innerExpression, checker)
    if (collectionCallbackTarget)
      return collectionCallbackTarget

    const callbackArgumentTarget = findCallbackArgumentTarget(innerExpression, checker)
    if (callbackArgumentTarget)
      return callbackArgumentTarget

    const callExpressionTarget = findCallExpressionDeclarationTarget(innerExpression, checker)
    if (callExpressionTarget)
      return callExpressionTarget
  }

  if (!typeIncludesUndefined(checker.getTypeAtLocation(expression)))
    return undefined

  return createExpressionTarget(expression)
}

function findJsxSpreadAttributeTarget(
  token: ts.Node,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const spreadAttribute = findAncestor(token, ts.isJsxSpreadAttribute)
  if (spreadAttribute)
    return findTargetFromExpression(spreadAttribute.expression, checker)

  const openingLikeElement = findAncestor(token, node =>
    ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))

  if (!openingLikeElement)
    return undefined

  for (const attribute of openingLikeElement.attributes.properties) {
    if (!ts.isJsxSpreadAttribute(attribute))
      continue

    const target = findTargetFromExpression(attribute.expression, checker)
    if (target)
      return target
  }

  return undefined
}

function findShorthandPropertyTarget(
  token: ts.Node,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const property = findAncestor(token, ts.isShorthandPropertyAssignment)
  if (!property)
    return undefined

  return typeIncludesUndefined(checker.getTypeAtLocation(property.name))
    ? createShorthandPropertyTarget(property)
    : undefined
}

function findPropertyAssignmentInitializerTarget(
  token: ts.Node,
  start: number,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const propertyAssignment = findAncestor(token, ts.isPropertyAssignment)
  if (!propertyAssignment)
    return undefined

  const propertyNameStart = propertyAssignment.name.getStart()
  const propertyNameEnd = propertyAssignment.name.getEnd()
  if (start < propertyNameStart || start >= propertyNameEnd)
    return undefined

  const directTarget = findTargetFromExpression(propertyAssignment.initializer, checker)
  if (directTarget)
    return directTarget

  const nestedTarget = findNestedContainerTarget(propertyAssignment.initializer, checker)
  if (nestedTarget)
    return nestedTarget

  if (!typeIncludesUndefined(checker.getTypeAtLocation(propertyAssignment.initializer)))
    return undefined

  return createExpressionTarget(propertyAssignment.initializer)
}

function findPropertyAccessExpressionTarget(
  token: ts.Node,
  start: number,
): EditTarget | undefined {
  const propertyAccess = findAncestor(token, ts.isPropertyAccessExpression)
  if (!propertyAccess)
    return undefined

  if (start >= propertyAccess.name.getStart() && start < propertyAccess.name.getEnd())
    return createExpressionTarget(propertyAccess.expression)

  return undefined
}

function findUndefinedAccessTarget(
  token: ts.Node,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  let current: ts.Node | undefined = token
  let bestTarget: EditTarget | undefined

  while (current) {
    if (ts.isPropertyAccessExpression(current)) {
      const expression = current.expression
      if (typeIncludesUndefined(checker.getTypeAtLocation(expression)) && !isAlreadyNonNull(expression))
        bestTarget = createExpressionTarget(expression)
    }

    if (ts.isElementAccessExpression(current)) {
      const expression = current.expression
      if (typeIncludesUndefined(checker.getTypeAtLocation(expression)) && !isAlreadyNonNull(expression))
        bestTarget = createExpressionTarget(expression)
    }

    current = current.parent
  }

  return bestTarget
}

function findElementAccessArgumentTarget(token: ts.Node): EditTarget | undefined {
  let current = token
  let matchingElementAccess: ts.ElementAccessExpression | undefined

  while (current) {
    if (ts.isElementAccessExpression(current) && current.argumentExpression)
      matchingElementAccess = current

    current = current.parent
  }

  if (!matchingElementAccess?.argumentExpression)
    return undefined

  return createExpressionTarget(matchingElementAccess.argumentExpression)
}

function findIterableTarget(
  sourceFile: ts.SourceFile,
  token: ts.Node,
  start: number,
  end: number,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const arrayLiteral = findAncestor(token, ts.isArrayLiteralExpression)
  if (arrayLiteral) {
    const arrayLiteralTarget = createArrayLiteralIterableFallbackTarget(arrayLiteral, checker)
    if (arrayLiteralTarget)
      return arrayLiteralTarget
  }

  const spreadElement = findAncestor(token, ts.isSpreadElement)
  if (spreadElement && !isAlreadyNonNull(spreadElement.expression))
    return createIterableFallbackTarget(spreadElement.expression)

  const variableDeclaration = findAncestor(token, ts.isVariableDeclaration)
  if (
    variableDeclaration?.initializer
    && typeIncludesUndefined(checker.getTypeAtLocation(variableDeclaration.initializer))
    && !isAlreadyNonNull(variableDeclaration.initializer)
  ) {
    return createExpressionTarget(variableDeclaration.initializer)
  }

  const binaryExpression = findAncestor(token, ts.isBinaryExpression)
  if (
    binaryExpression
    && isAssignmentOperator(binaryExpression.operatorToken.kind)
    && typeIncludesUndefined(checker.getTypeAtLocation(binaryExpression.right))
    && !isAlreadyNonNull(binaryExpression.right)
  ) {
    return createExpressionTarget(binaryExpression.right)
  }

  return undefined
}

function findImplicitAnyParameterTarget(token: ts.Node): EditTarget | undefined {
  const parameter = findAncestor(token, ts.isParameter)
  if (!parameter || parameter.type || !ts.isIdentifier(parameter.name))
    return undefined

  const sourceFile = parameter.getSourceFile()
  const replacement = ts.isArrowFunction(parameter.parent) && parameter.parent.parameters.length === 1
    ? `(${parameter.name.getText(sourceFile)}: any)`
    : `${parameter.name.getText(sourceFile)}: any`

  return createDirectEditTarget(
    sourceFile,
    parameter.getStart(sourceFile),
    parameter.getEnd(),
    replacement,
  )
}

function getArrayPatternElementTypeText(
  element: ts.ArrayBindingElement | ts.Expression,
  checker: ts.TypeChecker,
): string {
  if (ts.isOmittedExpression(element))
    return 'unknown'

  const targetNode = ts.isBindingElement(element)
    ? element.name
    : element

  const targetType = checker.getNonNullableType(checker.getTypeAtLocation(targetNode))
  const typeText = checker.typeToString(targetType)
  return typeText === 'never' ? 'unknown' : typeText
}

function createArrayDestructuringReplacement(
  sourceFile: ts.SourceFile,
  expression: ts.Expression,
  elements: readonly (ts.ArrayBindingElement | ts.Expression)[],
  checker: ts.TypeChecker,
  options?: {
    fallbackToEmptyArray?: boolean
  },
): string | undefined {
  if (elements.length === 0)
    return undefined

  const tupleTypes = elements.map(element => getArrayPatternElementTypeText(element, checker))
  const expressionText = options?.fallbackToEmptyArray
    ? `(${expression.getText(sourceFile)} ?? [])`
    : `(${expression.getText(sourceFile)})`
  return `${expressionText} as [${tupleTypes.join(', ')}]`
}

function findArrayDestructuringTarget(
  token: ts.Node,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const binaryExpression = findAncestor(token, ts.isBinaryExpression)
  if (binaryExpression && isAssignmentOperator(binaryExpression.operatorToken.kind) && ts.isArrayLiteralExpression(binaryExpression.left)) {
    const replacement = createArrayDestructuringReplacement(
      binaryExpression.getSourceFile(),
      binaryExpression.right,
      binaryExpression.left.elements,
      checker,
      {
        fallbackToEmptyArray: typeIncludesUndefined(checker.getTypeAtLocation(binaryExpression.right)),
      },
    )
    if (replacement) {
      return createDirectEditTarget(
        binaryExpression.getSourceFile(),
        binaryExpression.right.getStart(binaryExpression.getSourceFile()),
        binaryExpression.right.getEnd(),
        replacement,
      )
    }
  }

  const variableDeclaration = findAncestor(token, ts.isVariableDeclaration)
  if (variableDeclaration?.initializer && ts.isArrayBindingPattern(variableDeclaration.name)) {
    const replacement = createArrayDestructuringReplacement(
      variableDeclaration.getSourceFile(),
      variableDeclaration.initializer,
      variableDeclaration.name.elements,
      checker,
      {
        fallbackToEmptyArray: typeIncludesUndefined(checker.getTypeAtLocation(variableDeclaration.initializer)),
      },
    )
    if (replacement) {
      return createDirectEditTarget(
        variableDeclaration.getSourceFile(),
        variableDeclaration.initializer.getStart(variableDeclaration.getSourceFile()),
        variableDeclaration.initializer.getEnd(),
        replacement,
      )
    }
  }

  return undefined
}

function findVariableDeclarationInitializerTarget(
  sourceFile: ts.SourceFile,
  token: ts.Node,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const variableDeclaration = findAncestor(token, ts.isVariableDeclaration)
  if (!variableDeclaration?.initializer)
    return undefined

  const nestedTarget = findNestedContainerTarget(variableDeclaration.initializer, checker)
  if (nestedTarget)
    return nestedTarget

  if (!typeIncludesUndefined(checker.getTypeAtLocation(variableDeclaration.initializer)))
    return undefined

  return createExpressionTarget(variableDeclaration.initializer)
}

function getResolvedValueDeclaration(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
): ts.Declaration | undefined {
  if (!symbol)
    return undefined

  const resolvedSymbol = symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol

  return resolvedSymbol.valueDeclaration ?? resolvedSymbol.declarations?.[0]
}

function getFunctionLikeDeclaration(
  declaration: ts.Declaration,
): ts.FunctionLikeDeclarationBase | undefined {
  if (
    ts.isFunctionDeclaration(declaration)
    || ts.isMethodDeclaration(declaration)
    || ts.isFunctionExpression(declaration)
    || ts.isArrowFunction(declaration)
  ) {
    return declaration
  }

  if (
    ts.isVariableDeclaration(declaration)
    && declaration.initializer
    && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
  ) {
    return declaration.initializer
  }

  return undefined
}

function getPropertyNameText(name: ts.PropertyName | ts.BindingName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text

  return undefined
}

function getCallExpressionPropertyAccess(callExpression: ts.CallExpression): ts.PropertyAccessExpression | undefined {
  const callee = skipOuterExpressions(callExpression.expression)
  return ts.isPropertyAccessExpression(callee) ? callee : undefined
}

function getFunctionExpressionArgument(callExpression: ts.CallExpression, index = 0): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const callback = callExpression.arguments[index]
  return callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    ? callback
    : undefined
}

function findTargetInFunctionBody(
  body: ts.ConciseBody,
  resolveExpression: (expression: ts.Expression) => EditTarget | undefined,
): EditTarget | undefined {
  if (ts.isBlock(body)) {
    for (const expression of findReturnStatementExpressions(body)) {
      const target = resolveExpression(expression)
      if (target)
        return target
    }

    return undefined
  }

  return resolveExpression(body)
}

function getParameterCollectionExpression(
  declaration: ts.ParameterDeclaration,
): ts.Expression | undefined {
  const functionLikeDeclaration = declaration.parent
  if (
    !(ts.isArrowFunction(functionLikeDeclaration) || ts.isFunctionExpression(functionLikeDeclaration))
    || !ts.isCallExpression(functionLikeDeclaration.parent)
    || functionLikeDeclaration.parent.arguments[0] !== functionLikeDeclaration
  ) {
    return undefined
  }

  const callee = getCallExpressionPropertyAccess(functionLikeDeclaration.parent)
  return callee?.expression
}

function findObjectLiteralNamedPropertyTarget(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property))
      continue

    if (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName)
      return createShorthandPropertyTarget(property)

    if (ts.isPropertyAssignment(property)) {
      const currentPropertyName = getPropertyNameText(property.name)
      if (currentPropertyName !== propertyName)
        continue

      return findTargetFromExpression(property.initializer, checker)
        ?? createExpressionTarget(property.initializer)
    }
  }

  return undefined
}

function findFunctionLikeNamedReturnTarget(
  declaration: ts.FunctionLikeDeclarationBase,
  propertyName: string,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  if (!declaration.body)
    return undefined

  return findTargetInFunctionBody(
    declaration.body,
    expression => findNamedPropertyTarget(expression, propertyName, checker),
  )
}

function findCollectionPropertyTarget(
  expression: ts.Expression,
  propertyName: string,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const innerExpression = skipOuterExpressions(expression)

  if (ts.isIdentifier(innerExpression))
    return findNamedPropertyTarget(innerExpression, propertyName, checker)

  if (!ts.isCallExpression(innerExpression))
    return undefined

  const callee = getCallExpressionPropertyAccess(innerExpression)
  if (!callee)
    return undefined

  if (callee.name.text === 'map' || callee.name.text === 'flatMap') {
    const callback = getFunctionExpressionArgument(innerExpression)
    if (!callback)
      return undefined

    return findTargetInFunctionBody(
      callback.body,
      returnedExpression => findNamedPropertyTarget(returnedExpression, propertyName, checker),
    )
  }

  if (callee.name.text === 'filter')
    return findCollectionPropertyTarget(callee.expression, propertyName, checker)

  return undefined
}

function findNamedPropertyTarget(
  expression: ts.Expression,
  propertyName: string,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const innerExpression = skipOuterExpressions(expression)

  if (ts.isObjectLiteralExpression(innerExpression))
    return findObjectLiteralNamedPropertyTarget(innerExpression, propertyName, checker)

  if (ts.isIdentifier(innerExpression)) {
    const declaration = getResolvedValueDeclaration(checker.getSymbolAtLocation(innerExpression), checker)
    if (!declaration)
      return undefined

    if (ts.isParameter(declaration)) {
      const collectionExpression = getParameterCollectionExpression(declaration)
      if (collectionExpression)
        return findCollectionPropertyTarget(collectionExpression, propertyName, checker)
    }

    const functionLikeDeclaration = getFunctionLikeDeclaration(declaration)
    if (functionLikeDeclaration)
      return findFunctionLikeNamedReturnTarget(functionLikeDeclaration, propertyName, checker)

    if (ts.isVariableDeclaration(declaration) && declaration.initializer)
      return findNamedPropertyTarget(declaration.initializer, propertyName, checker)

    return undefined
  }

  if (ts.isCallExpression(innerExpression)) {
    const collectionPropertyTarget = findCollectionPropertyTarget(innerExpression, propertyName, checker)
    if (collectionPropertyTarget)
      return collectionPropertyTarget

    const declaration = getResolvedValueDeclaration(checker.getSymbolAtLocation(skipOuterExpressions(innerExpression.expression)), checker)
    if (!declaration)
      return undefined

    const functionLikeDeclaration = getFunctionLikeDeclaration(declaration)
    if (!functionLikeDeclaration)
      return undefined

    return findFunctionLikeNamedReturnTarget(functionLikeDeclaration, propertyName, checker)
  }

  return undefined
}

function findReturnStatementExpressions(node: ts.Node): ts.Expression[] {
  const expressions: ts.Expression[] = []

  const visit = (current: ts.Node) => {
    if (
      current !== node
      && (
        ts.isArrowFunction(current)
        || ts.isFunctionExpression(current)
        || ts.isFunctionDeclaration(current)
        || ts.isMethodDeclaration(current)
      )
    ) {
      return
    }

    if (ts.isReturnStatement(current) && current.expression)
      expressions.push(current.expression)

    current.forEachChild(visit)
  }

  visit(node)
  return expressions
}

function findFunctionLikeReturnTarget(
  declaration: ts.FunctionLikeDeclarationBase,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  if (!declaration.body)
    return undefined

  return findTargetInFunctionBody(
    declaration.body,
    expression => findTargetFromExpression(expression, checker),
  )
}

function findCallExpressionDeclarationTarget(
  callExpression: ts.CallExpression,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const declaration = getResolvedValueDeclaration(checker.getSymbolAtLocation(skipOuterExpressions(callExpression.expression)), checker)
  if (!declaration)
    return undefined

  const functionLikeDeclaration = getFunctionLikeDeclaration(declaration)
  if (!functionLikeDeclaration)
    return undefined

  return findFunctionLikeReturnTarget(functionLikeDeclaration, checker)
}

function findCallbackArgumentTarget(
  callExpression: ts.CallExpression,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const callee = skipOuterExpressions(callExpression.expression)
  const calleeName = ts.isIdentifier(callee) ? callee.text : getCallExpressionPropertyAccess(callExpression)?.name.text

  if (calleeName !== 'useCallback' && calleeName !== 'useMemo')
    return undefined

  const callback = getFunctionExpressionArgument(callExpression)
  if (!callback)
    return undefined

  return findFunctionLikeReturnTarget(callback, checker)
}

function findReferencedDeclarationInitializerTarget(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const innerExpression = skipOuterExpressions(expression)
  if (!ts.isIdentifier(innerExpression))
    return undefined

  const declaration = getResolvedValueDeclaration(checker.getSymbolAtLocation(innerExpression), checker)
  if (!declaration)
    return undefined

  if (ts.isBindingElement(declaration)) {
    const propertyName = declaration.propertyName
      ? getPropertyNameText(declaration.propertyName)
      : getPropertyNameText(declaration.name)

    const variableDeclaration = declaration.parent.parent
    if (propertyName && ts.isVariableDeclaration(variableDeclaration) && variableDeclaration.initializer) {
      const namedPropertyTarget = findNamedPropertyTarget(variableDeclaration.initializer, propertyName, checker)
      if (namedPropertyTarget)
        return namedPropertyTarget
    }
  }

  if (ts.isParameter(declaration)) {
    const collectionExpression = getParameterCollectionExpression(declaration)
    if (collectionExpression) {
      const collectionTarget = findTargetFromExpression(collectionExpression, checker)
      if (collectionTarget)
        return collectionTarget
    }
  }

  const functionLikeDeclaration = getFunctionLikeDeclaration(declaration)
  if (functionLikeDeclaration) {
    const functionTarget = findFunctionLikeReturnTarget(functionLikeDeclaration, checker)
    if (functionTarget)
      return functionTarget
  }

  if (!ts.isVariableDeclaration(declaration) || !declaration.initializer)
    return undefined

  const collectionCallbackTarget = findCollectionCallbackTarget(declaration.initializer, checker)
  if (collectionCallbackTarget)
    return collectionCallbackTarget

  const initializerTarget = findTargetFromExpression(declaration.initializer, checker)
  if (initializerTarget)
    return initializerTarget

  const nestedTarget = findNestedContainerTarget(declaration.initializer, checker)
  if (nestedTarget)
    return nestedTarget

  if (!typeIncludesUndefined(checker.getTypeAtLocation(declaration.initializer)))
    return undefined

  return createExpressionTarget(declaration.initializer)
}

function findCollectionCallbackTarget(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const innerExpression = skipOuterExpressions(expression)
  if (!ts.isCallExpression(innerExpression))
    return undefined

  const callee = getCallExpressionPropertyAccess(innerExpression)
  if (!callee)
    return undefined

  if (callee.name.text !== 'map' && callee.name.text !== 'flatMap')
    return undefined

  const callback = getFunctionExpressionArgument(innerExpression)
  if (!callback)
    return undefined

  return findFunctionLikeReturnTarget(callback, checker)
}

function findJsxComponentDeclarationTarget(
  token: ts.Node,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const openingLikeElement = findAncestor(token, node =>
    ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
  if (!openingLikeElement)
    return undefined

  const tagName = openingLikeElement.tagName
  if (!ts.isIdentifier(tagName))
    return undefined

  const symbol = checker.getSymbolAtLocation(tagName)
  const declaration = symbol?.valueDeclaration
  if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer)
    return undefined

  if (!typeIncludesUndefined(checker.getTypeAtLocation(declaration.initializer)))
    return undefined

  return createExpressionTarget(declaration.initializer)
}

function findObjectLiteralPropertyTarget(
  objectLiteral: ts.ObjectLiteralExpression,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      const directTarget = findTargetFromExpression(property.expression, checker)
      if (directTarget)
        return directTarget

      if (typeIncludesUndefined(checker.getTypeAtLocation(property.expression)))
        return createExpressionTarget(property.expression)
      continue
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      if (typeIncludesUndefined(checker.getTypeAtLocation(property.name)))
        return createShorthandPropertyTarget(property)
      continue
    }

    if (ts.isPropertyAssignment(property)) {
      const directTarget = findTargetFromExpression(property.initializer, checker)
      if (directTarget)
        return directTarget

      const nestedTarget = findNestedContainerTarget(property.initializer, checker)
      if (nestedTarget)
        return nestedTarget

      if (typeIncludesUndefined(checker.getTypeAtLocation(property.initializer)))
        return createExpressionTarget(property.initializer)
    }
  }

  return undefined
}

function findArrayLiteralElementTarget(
  arrayLiteral: ts.ArrayLiteralExpression,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const iterableFallbackTarget = createArrayLiteralIterableFallbackTarget(arrayLiteral, checker)
  if (iterableFallbackTarget)
    return iterableFallbackTarget

  for (const element of arrayLiteral.elements) {
    if (ts.isSpreadElement(element)) {
      const directTarget = findTargetFromExpression(element.expression, checker)
      if (directTarget)
        return directTarget

      if (typeIncludesUndefined(checker.getTypeAtLocation(element.expression)))
        return createExpressionTarget(element.expression)
      continue
    }

    const directTarget = findTargetFromExpression(element, checker)
    if (directTarget)
      return directTarget

    const nestedTarget = findNestedContainerTarget(element, checker)
    if (nestedTarget)
      return nestedTarget

    if (typeIncludesUndefined(checker.getTypeAtLocation(element)))
      return createExpressionTarget(element)
  }

  for (let index = arrayLiteral.elements.length - 1; index >= 0; index -= 1) {
    const element = arrayLiteral.elements[index]
    if (!element)
      continue

    if (ts.isSpreadElement(element))
      continue

    if (!isAlreadyNonNull(element))
      return createExpressionTarget(element)
  }

  return undefined
}

function findNestedContainerTarget(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const innerExpression = skipOuterExpressions(expression)
  if (ts.isObjectLiteralExpression(innerExpression))
    return findObjectLiteralPropertyTarget(innerExpression, checker)

  if (ts.isArrayLiteralExpression(innerExpression))
    return findArrayLiteralElementTarget(innerExpression, checker)

  return undefined
}

function findAccessDiagnosticTarget(
  sourceFile: ts.SourceFile,
  token: ts.Node,
  start: number,
  end: number,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const directExpression = findTightestExpression(sourceFile, start, end)
  if (directExpression) {
    if (typeIncludesUndefined(checker.getTypeAtLocation(directExpression)) && !isAlreadyNonNull(directExpression))
      return createExpressionTarget(directExpression)

    const referencedDeclarationTarget = findReferencedDeclarationInitializerTarget(directExpression, checker)
    if (referencedDeclarationTarget && isExpressionTarget(referencedDeclarationTarget) && !isAlreadyNonNull(referencedDeclarationTarget.expression))
      return referencedDeclarationTarget
  }

  const bindingPatternTarget = findVariableDeclarationInitializerTarget(sourceFile, token, checker)
  if (bindingPatternTarget && isExpressionTarget(bindingPatternTarget) && !isAlreadyNonNull(bindingPatternTarget.expression))
    return bindingPatternTarget

  const accessTarget = findUndefinedAccessTarget(token, checker)
  if (accessTarget && isExpressionTarget(accessTarget) && !isAlreadyNonNull(accessTarget.expression))
    return accessTarget

  const propertyAccessTarget = findPropertyAccessExpressionTarget(token, start)
  if (propertyAccessTarget && isExpressionTarget(propertyAccessTarget) && !isAlreadyNonNull(propertyAccessTarget.expression))
    return propertyAccessTarget

  return undefined
}

function findDiagnosticCandidate(
  sourceFile: ts.SourceFile,
  token: ts.Node,
  start: number,
  end: number,
  diagnosticCode: number,
  checker: ts.TypeChecker,
): ts.Expression | undefined {
  if (diagnosticCode === 2322) {
    const directExpression = findTightestExpression(sourceFile, start, end)
    if (directExpression && typeIncludesUndefined(checker.getTypeAtLocation(directExpression)))
      return directExpression

    return findAssignmentLikeCandidate(token, sourceFile, start, end)
  }

  if (diagnosticCode === 2345)
    return findArgumentCandidate(token, sourceFile, start, end)

  if (diagnosticCode === 2722) {
    const current = findTightestExpression(sourceFile, start, end)
    if (current && ts.isCallExpression(current))
      return current.expression

    return findTightestExpression(sourceFile, start, end)
  }

  return findTightestExpression(sourceFile, start, end)
}

function resolveEditTarget(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
  checker: ts.TypeChecker,
): EditTarget | undefined {
  const start = diagnostic.start
  const end = diagnostic.start + diagnostic.length
  const token = getTokenAtPosition(sourceFile, start)

  const shorthandTarget = findShorthandPropertyTarget(token, checker)
  if (shorthandTarget)
    return shorthandTarget

  const propertyAssignmentTarget = findPropertyAssignmentInitializerTarget(token, start, checker)
  if (propertyAssignmentTarget)
    return propertyAssignmentTarget

  const jsxSpreadTarget = findJsxSpreadAttributeTarget(token, checker)
  if (jsxSpreadTarget && isExpressionTarget(jsxSpreadTarget) && !isAlreadyNonNull(jsxSpreadTarget.expression))
    return jsxSpreadTarget

  const jsxAttribute = findAncestor(token, ts.isJsxAttribute)
  const jsxExpression = jsxAttribute ? getExpressionFromJsxAttribute(jsxAttribute) : undefined

  if (
    ASSIGNABILITY_DIAGNOSTIC_CODES.has(diagnostic.code)
    && jsxExpression
    && typeIncludesUndefined(checker.getTypeAtLocation(jsxExpression))
    && !isAlreadyNonNull(jsxExpression)
  ) {
    return findTargetFromExpression(jsxExpression, checker)
      ?? createExpressionTarget(jsxExpression)
  }

  if (ACCESS_DIAGNOSTIC_CODES.has(diagnostic.code))
    return findAccessDiagnosticTarget(sourceFile, token, start, end, checker)

  if (diagnostic.code === 2322 || diagnostic.code === 2488) {
    const arrayDestructuringTarget = findArrayDestructuringTarget(token, checker)
    if (arrayDestructuringTarget)
      return arrayDestructuringTarget
  }

  if (diagnostic.code === 2538) {
    const elementAccessTarget = findElementAccessArgumentTarget(token)
    if (elementAccessTarget && isExpressionTarget(elementAccessTarget) && !isAlreadyNonNull(elementAccessTarget.expression))
      return elementAccessTarget
  }

  if (diagnostic.code === 7006)
    return findImplicitAnyParameterTarget(token)

  if (diagnostic.code === 2488) {
    const iterableTarget = findIterableTarget(sourceFile, token, start, end, checker)
    if (iterableTarget && (!isExpressionTarget(iterableTarget) || !isAlreadyNonNull(iterableTarget.expression)))
      return iterableTarget
  }

  if (diagnostic.code === 2604 || diagnostic.code === 2786) {
    const jsxComponentTarget = findJsxComponentDeclarationTarget(token, checker)
    if (jsxComponentTarget && isExpressionTarget(jsxComponentTarget) && !isAlreadyNonNull(jsxComponentTarget.expression))
      return jsxComponentTarget
  }

  const candidate = findDiagnosticCandidate(sourceFile, token, start, end, diagnostic.code, checker)

  if (!candidate) {
    return jsxExpression && !isAlreadyNonNull(jsxExpression)
      ? createExpressionTarget(jsxExpression)
      : undefined
  }

  if (ASSIGNABILITY_DIAGNOSTIC_CODES.has(diagnostic.code)) {
    if (
      diagnostic.code === 2345
      && typeIncludesUndefined(checker.getTypeAtLocation(candidate))
      && !isAlreadyNonNull(candidate)
      && (
        ts.isIdentifier(candidate)
        || ts.isElementAccessExpression(candidate)
        || ts.isPropertyAccessExpression(candidate)
      )
    ) {
      return createExpressionTarget(candidate)
    }

    const referencedDeclarationTarget = findReferencedDeclarationInitializerTarget(candidate, checker)
    if (referencedDeclarationTarget && isExpressionTarget(referencedDeclarationTarget) && !isAlreadyNonNull(referencedDeclarationTarget.expression))
      return referencedDeclarationTarget

    const collectionCallbackTarget = findCollectionCallbackTarget(candidate, checker)
    if (collectionCallbackTarget && isExpressionTarget(collectionCallbackTarget) && !isAlreadyNonNull(collectionCallbackTarget.expression))
      return collectionCallbackTarget
  }

  const targetFromCandidate = findTargetFromExpression(candidate, checker)
  if (targetFromCandidate && (!isExpressionTarget(targetFromCandidate) || !isAlreadyNonNull(targetFromCandidate.expression)))
    return targetFromCandidate

  if (ASSIGNABILITY_DIAGNOSTIC_CODES.has(diagnostic.code) && (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate))) {
    const functionTarget = findFunctionLikeReturnTarget(candidate, checker)
    if (functionTarget && isExpressionTarget(functionTarget) && !isAlreadyNonNull(functionTarget.expression))
      return functionTarget
  }

  const nestedContainerTarget = findNestedContainerTarget(candidate, checker)
  if (nestedContainerTarget)
    return nestedContainerTarget

  if (isAlreadyNonNull(candidate))
    return undefined

  if (ASSIGNABILITY_DIAGNOSTIC_CODES.has(diagnostic.code) && ts.isObjectLiteralExpression(candidate)) {
    const objectLiteralTarget = findObjectLiteralPropertyTarget(candidate, checker)
    if (objectLiteralTarget)
      return objectLiteralTarget
  }

  if (diagnostic.code === 2322) {
    const declarationInitializerTarget = findVariableDeclarationInitializerTarget(sourceFile, token, checker)
    if (declarationInitializerTarget && isExpressionTarget(declarationInitializerTarget) && !isAlreadyNonNull(declarationInitializerTarget.expression))
      return declarationInitializerTarget
  }

  if (ASSIGNABILITY_DIAGNOSTIC_CODES.has(diagnostic.code) && !typeIncludesUndefined(checker.getTypeAtLocation(candidate)))
    return undefined

  return createExpressionTarget(candidate)
}

function createEditForTarget(
  target: EditTarget,
  printer: ts.Printer,
): TextEdit {
  const sourceFile = target.sourceFile

  if (target.kind === 'direct-edit') {
    return {
      end: target.end,
      expectedText: sourceFile.text.slice(target.start, target.end),
      replacement: target.replacement,
      start: target.start,
    }
  }

  if (target.kind === 'shorthand-property') {
    const name = target.property.name
    const nonNullName = printer.printNode(
      ts.EmitHint.Expression,
      ts.factory.createNonNullExpression(name),
      sourceFile,
    )
    return {
      end: target.property.getEnd(),
      expectedText: sourceFile.text.slice(target.property.getStart(sourceFile), target.property.getEnd()),
      replacement: `${name.getText(sourceFile)}: ${nonNullName}`,
      start: target.property.getStart(sourceFile),
    }
  }

  const replacement = shouldPrintInlineNonNullAssertion(target.expression)
    ? `${target.expression.getText(sourceFile)}!`
    : printer.printNode(
        ts.EmitHint.Expression,
        ts.factory.createNonNullExpression(target.expression),
        sourceFile,
      )

  return {
    end: target.expression.getEnd(),
    expectedText: sourceFile.text.slice(target.expression.getStart(sourceFile), target.expression.getEnd()),
    replacement,
    start: target.expression.getStart(sourceFile),
  }
}

function hasOverlap(existingEdits: TextEdit[], nextEdit: TextEdit): boolean {
  return existingEdits.some(edit => nextEdit.start < edit.end && edit.start < nextEdit.end)
}

function applyEdits(text: string, edits: TextEdit[]): { appliedEditCount: number, text: string } {
  let currentText = text
  let appliedEditCount = 0

  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    if (edit.replacement.length > currentText.length * 4)
      continue

    try {
      currentText = `${currentText.slice(0, edit.start)}${edit.replacement}${currentText.slice(edit.end)}`
      appliedEditCount += 1
    }
    catch {
      continue
    }
  }

  return {
    appliedEditCount,
    text: currentText,
  }
}

function isValidEditRange(text: string, edit: TextEdit): boolean {
  return Number.isInteger(edit.start)
    && Number.isInteger(edit.end)
    && edit.start >= 0
    && edit.end >= edit.start
    && edit.end <= text.length
}

function filterApplicableEdits(text: string, edits: TextEdit[]): TextEdit[] {
  return edits.filter(edit => isValidEditRange(text, edit) && (!edit.expectedText || text.slice(edit.start, edit.end) === edit.expectedText))
}

export async function runMigration(options: CliOptions) {
  const projectPath = path.resolve(process.cwd(), options.project)
  const parsedConfig = parseTsConfig(projectPath)
  const matchesRequestedFile = createFileMatcher(options.files)
  const targetFiles = parsedConfig.fileNames
    .map(normalizeFileName)
    .filter(isTargetFile)
    .filter(matchesRequestedFile)

  if (targetFiles.length === 0) {
    console.error('No matching TypeScript source files found.')
    process.exitCode = 1
    return { converged: false, totalEdits: 0 }
  }

  const fileTexts = new Map<string, string>()
  const printer = ts.createPrinter()
  const migrationRootNames = options.useFullProjectRoots
    ? parsedConfig.fileNames.map(normalizeFileName)
    : getMigrationRootNames(parsedConfig, targetFiles)

  let totalEdits = 0
  let converged = false
  let previousProgram: ts.Program | undefined

  for (let iteration = 1; iteration <= options.maxIterations; iteration += 1) {
    const program = createMigrationProgram(migrationRootNames, parsedConfig, fileTexts, previousProgram)
    const checker = program.getTypeChecker()
    const editsByFile = new Map<string, TextEdit[]>()

    for (const fileName of targetFiles) {
      const sourceFile = program.getSourceFile(fileName)
      if (!sourceFile)
        continue

      const diagnostics = program
        .getSemanticDiagnostics(sourceFile)
        .filter((diagnostic): diagnostic is ts.DiagnosticWithLocation => {
          return diagnostic.file !== undefined
            && diagnostic.start !== undefined
            && diagnostic.length !== undefined
            && SUPPORTED_DIAGNOSTIC_CODES.has(diagnostic.code)
        })

      if (options.verbose && diagnostics.length > 0)
        console.log(`file ${path.relative(process.cwd(), fileName)}: ${diagnostics.length} supported diagnostic(s)`)

      for (const diagnostic of diagnostics) {
        const target = resolveEditTarget(sourceFile, diagnostic, checker)
        if (!target) {
          if (options.verbose)
            console.log(`unresolved ${formatDiagnostic(diagnostic)}`)
          continue
        }

        const editFileName = target.sourceFile.fileName
        const edit = createEditForTarget(target, printer)
        const existing = editsByFile.get(editFileName) ?? []
        if (hasOverlap(existing, edit))
          continue

        existing.push(edit)
        editsByFile.set(editFileName, existing)

        if (options.verbose) {
          const position = target.sourceFile.getLineAndCharacterOfPosition(edit.start)
          console.log(`iter ${iteration}: ${path.relative(process.cwd(), editFileName)}:${position.line + 1}:${position.character + 1} -> add !`)
        }
      }
    }

    if (editsByFile.size === 0) {
      console.log(`No more supported diagnostics after ${iteration - 1} iteration(s).`)
      converged = true
      break
    }

    let iterationEditCount = 0

    for (const [fileName, edits] of editsByFile) {
      const currentText = fileTexts.get(fileName) ?? await fs.readFile(fileName, 'utf8')
      const applicableEdits = filterApplicableEdits(currentText, edits)
      if (applicableEdits.length === 0)
        continue

      const { appliedEditCount, text: editedText } = applyEdits(currentText, applicableEdits)
      if (appliedEditCount === 0)
        continue

      const nextText = normalizeMalformedAssertions(editedText)
      if (nextText === currentText) {
        if (options.verbose) {
          const firstEdit = applicableEdits[0]
          console.log(`iter ${iteration}: no-op after normalization for ${path.relative(process.cwd(), fileName)}:${firstEdit?.start ?? 0} ${JSON.stringify(firstEdit ? currentText.slice(firstEdit.start, firstEdit.end) : '')} -> ${JSON.stringify(firstEdit?.replacement ?? '')}`)
        }
        continue
      }

      fileTexts.set(fileName, nextText)
      iterationEditCount += appliedEditCount
    }

    totalEdits += iterationEditCount
    console.log(`Iteration ${iteration}: ${iterationEditCount} edit(s) across ${editsByFile.size} file(s).`)
    previousProgram = program
  }

  if (totalEdits === 0) {
    console.log('No supported noUncheckedIndexedAccess-style diagnostics were migrated.')
    return { converged, totalEdits }
  }

  if (!options.write) {
    if (!converged)
      console.log(`Stopped after reaching --max-iterations=${options.maxIterations}.`)

    console.log(`Dry run complete. ${totalEdits} edit(s) are ready. Re-run with --write to apply them.`)
    return { converged, totalEdits }
  }

  const changedFiles = Array.from(fileTexts.entries())
  await Promise.all(changedFiles.map(async ([fileName, text]) => {
    await fs.writeFile(fileName, text)
  }))

  if (!converged)
    console.log(`Stopped after reaching --max-iterations=${options.maxIterations}.`)

  console.log(`Wrote ${totalEdits} edit(s) to ${changedFiles.length} file(s).`)
  return { converged, totalEdits }
}

export async function runMigrationCommand(argv: string[]) {
  await runMigration(parseArgs(argv))
}
