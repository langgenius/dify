import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ts from 'typescript'

type TextEdit = {
  end: number
  replacement: string
  start: number
}

export type TransformSourceResult = {
  changes: number
  output: string
}

const I18N_MODULES = new Set(['#i18n', 'i18next', 'react-i18next'])
const MOCK_PROVIDER_METHODS = new Set(['mockImplementation', 'mockImplementationOnce', 'mockReturnValue', 'mockReturnValueOnce'])
const SKIPPED_DIRECTORIES = new Set(['.next', '.turbo', '.vinext', 'coverage', 'dist', 'i18n', 'node_modules', 'public'])
const SKIPPED_FILES = new Set(['migrate-i18n-selectors.spec.ts'])
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const TRANSLATION_FACTORIES = new Set(['getTranslation', 'useTranslation'])

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

type ImportBinding = {
  importedName: string
  moduleName: string
}

function createSourceAnalysis(source: string, fileName: string, scriptKind: ts.ScriptKind) {
  const resolvedFileName = path.resolve(fileName)
  const sourceFile = ts.createSourceFile(resolvedFileName, source, ts.ScriptTarget.Latest, true, scriptKind)
  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.Preserve,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.Latest,
  }
  const defaultHost = ts.createCompilerHost(compilerOptions)
  const host: ts.CompilerHost = {
    ...defaultHost,
    fileExists: candidate => path.resolve(candidate) === resolvedFileName,
    getSourceFile: candidate => path.resolve(candidate) === resolvedFileName ? sourceFile : undefined,
    readFile: candidate => path.resolve(candidate) === resolvedFileName ? source : undefined,
  }
  const program = ts.createProgram([resolvedFileName], compilerOptions, host)

  return { checker: program.getTypeChecker(), sourceFile }
}

function getImportBinding(declaration: ts.Declaration): ImportBinding | undefined {
  let current: ts.Node | undefined = declaration
  while (current && !ts.isImportDeclaration(current))
    current = current.parent

  if (!current || !ts.isStringLiteral(current.moduleSpecifier))
    return undefined

  if (ts.isImportSpecifier(declaration)) {
    return {
      importedName: declaration.propertyName?.text ?? declaration.name.text,
      moduleName: current.moduleSpecifier.text,
    }
  }

  if (ts.isImportClause(declaration)) {
    return {
      importedName: 'default',
      moduleName: current.moduleSpecifier.text,
    }
  }

  if (ts.isNamespaceImport(declaration)) {
    return {
      importedName: '*',
      moduleName: current.moduleSpecifier.text,
    }
  }

  return undefined
}

function getDeclarations(identifier: ts.Identifier, checker: ts.TypeChecker) {
  return checker.getSymbolAtLocation(identifier)?.declarations ?? []
}

function isImportedBinding(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  importedName: string,
  isAllowedModule: (moduleName: string) => boolean,
) {
  return getDeclarations(identifier, checker).some((declaration) => {
    const binding = getImportBinding(declaration)
    return binding?.importedName === importedName && isAllowedModule(binding.moduleName)
  })
}

function isTranslationFactoryIdentifier(identifier: ts.Identifier, checker: ts.TypeChecker) {
  return getDeclarations(identifier, checker).some((declaration) => {
    const binding = getImportBinding(declaration)
    return Boolean(
      binding
      && TRANSLATION_FACTORIES.has(binding.importedName)
      && (I18N_MODULES.has(binding.moduleName) || binding.moduleName.toLowerCase().includes('i18n')),
    )
  })
}

function isGetI18nIdentifier(identifier: ts.Identifier, checker: ts.TypeChecker) {
  return isImportedBinding(identifier, checker, 'getI18n', moduleName => I18N_MODULES.has(moduleName))
}

function isTranslationFactoryCall(expression: ts.Expression, checker: ts.TypeChecker) {
  const unwrapped = ts.isAwaitExpression(expression)
    ? unwrapExpression(expression.expression)
    : unwrapExpression(expression)

  return ts.isCallExpression(unwrapped)
    && ts.isIdentifier(unwrapped.expression)
    && isTranslationFactoryIdentifier(unwrapped.expression, checker)
}

function getBindingElementPropertyName(declaration: ts.BindingElement) {
  if (declaration.propertyName && (ts.isIdentifier(declaration.propertyName) || ts.isStringLiteral(declaration.propertyName)))
    return declaration.propertyName.text
  if (ts.isIdentifier(declaration.name))
    return declaration.name.text
  return undefined
}

function findAncestor<T extends ts.Node>(
  node: ts.Node,
  predicate: (candidate: ts.Node) => candidate is T,
): T | undefined {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (predicate(current))
      return current
    current = current.parent
  }
  return undefined
}

function hasTranslationFunctionType(parameter: ts.ParameterDeclaration, sourceFile: ts.SourceFile) {
  const typeText = parameter.type?.getText(sourceFile) ?? ''
  return /\b(?:TFunction|useTranslation)\b|(?:Translate|Translator)\b/.test(typeText)
    || typeText.trim() === 'any'
}

function isTranslationFunctionDeclaration(
  declaration: ts.Declaration,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
) {
  const importBinding = getImportBinding(declaration)
  if (importBinding)
    return importBinding.importedName === 't' && I18N_MODULES.has(importBinding.moduleName)

  if (ts.isBindingElement(declaration)) {
    if (getBindingElementPropertyName(declaration) !== 't')
      return false

    const variableDeclaration = findAncestor(declaration, ts.isVariableDeclaration)
    if (variableDeclaration?.initializer)
      return isTranslationFactoryCall(variableDeclaration.initializer, checker)

    const parameter = findAncestor(declaration, ts.isParameter)
    return Boolean(parameter && hasTranslationFunctionType(parameter, sourceFile))
  }

  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    const initializer = unwrapExpression(declaration.initializer)
    return ts.isPropertyAccessExpression(initializer)
      && initializer.name.text === 't'
      && isTranslationFactoryCall(initializer.expression, checker)
  }

  return ts.isParameter(declaration)
    && ts.isIdentifier(declaration.name)
    && declaration.name.text === 't'
    && hasTranslationFunctionType(declaration, sourceFile)
}

function isTranslationFunctionIdentifier(
  identifier: ts.Identifier,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
) {
  return getDeclarations(identifier, checker).some(declaration => (
    isTranslationFunctionDeclaration(declaration, checker, sourceFile)
  ))
}

function isI18nInstanceIdentifier(identifier: ts.Identifier, checker: ts.TypeChecker) {
  const declarations = getDeclarations(identifier, checker)
  if (!declarations.length)
    return identifier.text === 'i18n' || identifier.text === 'i18next'

  return declarations.some((declaration) => {
    const importBinding = getImportBinding(declaration)
    if (importBinding)
      return I18N_MODULES.has(importBinding.moduleName) && ['*', 'default', 'i18n', 'i18next'].includes(importBinding.importedName)

    if (ts.isBindingElement(declaration)) {
      const variableDeclaration = findAncestor(declaration, ts.isVariableDeclaration)
      return getBindingElementPropertyName(declaration) === 'i18n'
        && Boolean(variableDeclaration?.initializer && isTranslationFactoryCall(variableDeclaration.initializer, checker))
    }

    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer)
      return false

    const initializer = unwrapExpression(declaration.initializer)
    return ts.isCallExpression(initializer)
      && ts.isIdentifier(initializer.expression)
      && isGetI18nIdentifier(initializer.expression, checker)
  })
}

function getTypeReferenceName(typeName: ts.EntityName): string {
  return ts.isIdentifier(typeName) ? typeName.text : typeName.right.text
}

function hasSelectorType(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode)
    return false
  if (ts.isParenthesizedTypeNode(typeNode) || ts.isTypeOperatorNode(typeNode))
    return hasSelectorType(typeNode.type)
  if (ts.isTypeReferenceNode(typeNode))
    return ['SelectorKey', 'SelectorParam'].includes(getTypeReferenceName(typeNode.typeName))
  if (ts.isUnionTypeNode(typeNode)) {
    const meaningfulTypes = typeNode.types.filter(type => (
      type.kind !== ts.SyntaxKind.UndefinedKeyword
      && type.kind !== ts.SyntaxKind.NeverKeyword
      && !(ts.isLiteralTypeNode(type) && type.literal.kind === ts.SyntaxKind.NullKeyword)
    ))
    return meaningfulTypes.length > 0 && meaningfulTypes.every(hasSelectorType)
  }
  return false
}

function hasSelectorCollectionType(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode)
    return false
  if (ts.isParenthesizedTypeNode(typeNode) || ts.isTypeOperatorNode(typeNode))
    return hasSelectorCollectionType(typeNode.type)
  if (ts.isUnionTypeNode(typeNode))
    return typeNode.types.some(hasSelectorCollectionType)
  if (ts.isArrayTypeNode(typeNode))
    return hasSelectorType(typeNode.elementType)
  if (!ts.isTypeReferenceNode(typeNode))
    return false

  const typeName = getTypeReferenceName(typeNode.typeName)
  const typeArguments = typeNode.typeArguments ?? []
  if (typeName === 'Record')
    return hasSelectorType(typeArguments[1])
  if (typeName === 'Array' || typeName === 'ReadonlyArray')
    return hasSelectorType(typeArguments[0])
  return false
}

function hasCallableType(expression: ts.Expression, checker: ts.TypeChecker) {
  const type = checker.getTypeAtLocation(expression)
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
    return false
  return checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0
}

function isSelectorCollectionExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seenSymbols: Set<ts.Symbol>,
): boolean {
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression))
    return isSelectorCollectionExpression(expression.expression, checker, sourceFile, seenSymbols)

  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    if (hasSelectorCollectionType(expression.type))
      return true
    return isSelectorCollectionExpression(expression.expression, checker, sourceFile, seenSymbols)
  }

  if (ts.isObjectLiteralExpression(expression)) {
    const values = expression.properties.flatMap((property): ts.Expression[] => {
      if (ts.isPropertyAssignment(property))
        return [property.initializer]
      if (ts.isShorthandPropertyAssignment(property))
        return [property.name]
      return []
    })
    return values.length > 0 && values.every(value => (
      isSelectorCompatibleExpression(value, checker, sourceFile, new Set(seenSymbols))
    ))
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.length > 0 && expression.elements.every(element => (
      !ts.isSpreadElement(element)
      && isSelectorCompatibleExpression(element, checker, sourceFile, new Set(seenSymbols))
    ))
  }

  if (!ts.isIdentifier(expression))
    return false

  const symbol = checker.getSymbolAtLocation(expression)
  if (!symbol || seenSymbols.has(symbol))
    return false
  seenSymbols.add(symbol)

  return (symbol.declarations ?? []).some((declaration) => {
    if (ts.isVariableDeclaration(declaration)) {
      return hasSelectorCollectionType(declaration.type)
        || Boolean(declaration.initializer && isSelectorCollectionExpression(declaration.initializer, checker, sourceFile, seenSymbols))
    }
    if (ts.isParameter(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration))
      return hasSelectorCollectionType(declaration.type)
    return false
  })
}

function isSelectorCompatibleExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  seenSymbols = new Set<ts.Symbol>(),
): boolean {
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression))
    return isSelectorCompatibleExpression(expression.expression, checker, sourceFile, seenSymbols)

  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    if (hasSelectorType(expression.type))
      return true
    return isSelectorCompatibleExpression(expression.expression, checker, sourceFile, seenSymbols)
  }

  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))
    return true

  if (hasCallableType(expression, checker))
    return true

  if (ts.isConditionalExpression(expression)) {
    return isSelectorCompatibleExpression(expression.whenTrue, checker, sourceFile, new Set(seenSymbols))
      && isSelectorCompatibleExpression(expression.whenFalse, checker, sourceFile, new Set(seenSymbols))
  }

  if (ts.isElementAccessExpression(expression) || ts.isPropertyAccessExpression(expression)) {
    return isSelectorCollectionExpression(expression.expression, checker, sourceFile, seenSymbols)
  }

  if (!ts.isIdentifier(expression))
    return false

  const symbol = checker.getSymbolAtLocation(expression)
  if (!symbol || seenSymbols.has(symbol))
    return false
  seenSymbols.add(symbol)

  return (symbol.declarations ?? []).some((declaration) => {
    if (ts.isVariableDeclaration(declaration)) {
      return hasSelectorType(declaration.type)
        || Boolean(declaration.initializer && isSelectorCompatibleExpression(declaration.initializer, checker, sourceFile, seenSymbols))
    }
    if (ts.isParameter(declaration) || ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration))
      return hasSelectorType(declaration.type)
    return false
  })
}

function selectorFor(expression: ts.Expression, sourceFile: ts.SourceFile): string {
  if (ts.isArrayLiteralExpression(expression)) {
    const selectors = expression.elements.map((element) => {
      if (ts.isSpreadElement(element))
        return element.getText(sourceFile)
      return `$ => $[${element.getText(sourceFile)}]`
    })
    return `[${selectors.join(', ')}]`
  }

  return `$ => $[${expression.getText(sourceFile)}]`
}

function isStringExpression(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

function isTranslationCall(
  node: ts.CallExpression,
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
) {
  if (ts.isIdentifier(node.expression))
    return isTranslationFunctionIdentifier(node.expression, checker, sourceFile)

  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 't')
    return false

  const receiver = unwrapExpression(node.expression.expression)
  if (ts.isIdentifier(receiver))
    return isI18nInstanceIdentifier(receiver, checker)

  return ts.isCallExpression(receiver)
    && ts.isIdentifier(receiver.expression)
    && isGetI18nIdentifier(receiver.expression, checker)
}

function isTransComponent(identifier: ts.Identifier, checker: ts.TypeChecker) {
  return isImportedBinding(identifier, checker, 'Trans', moduleName => I18N_MODULES.has(moduleName))
}

function getJsxAttribute(node: ts.JsxOpeningLikeElement, name: string) {
  return node.attributes.properties.find((property): property is ts.JsxAttribute => {
    return ts.isJsxAttribute(property)
      && ts.isIdentifier(property.name)
      && property.name.text === name
  })
}

function getPropertyName(node: ts.ObjectLiteralElementLike) {
  if (!('name' in node) || !node.name)
    return undefined
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    return node.name.text
  return undefined
}

function isI18nMock(node: ts.CallExpression) {
  if (
    !ts.isPropertyAccessExpression(node.expression)
    || !ts.isIdentifier(node.expression.expression)
    || node.expression.expression.text !== 'vi'
    || node.expression.name.text !== 'mock'
  ) {
    return false
  }

  const moduleName = node.arguments[0]
  return Boolean(moduleName && ts.isStringLiteral(moduleName) && I18N_MODULES.has(moduleName.text))
}

function isVitestValueWrapper(node: ts.CallExpression) {
  return ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'vi'
    && (node.expression.name.text === 'fn' || node.expression.name.text === 'hoisted')
}

function applyEdits(source: string, edits: TextEdit[]) {
  let output = source
  for (const edit of [...edits].sort((left, right) => right.start - left.start))
    output = `${output.slice(0, edit.start)}${edit.replacement}${output.slice(edit.end)}`
  return output
}

export function transformSource(source: string, fileName: string): TransformSourceResult {
  const scriptKind = fileName.endsWith('.tsx') || fileName.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS
  const { checker, sourceFile } = createSourceAnalysis(source, fileName, scriptKind)

  return transformAnalyzedSource(source, sourceFile, checker)
}

function transformAnalyzedSource(
  source: string,
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
): TransformSourceResult {
  const edits: TextEdit[] = []
  const consumedEdits = new Set<TextEdit>()
  const mockEditStarts = new Set<number>()
  const mockProviderSymbols = new Set<ts.Symbol>()
  const visitedMockModuleSymbols = new Set<ts.Symbol>()
  const visitedMockProviderSymbols = new Set<ts.Symbol>()
  const neededSelectorMockImports = new Set<string>()
  const mockFactoryImports = new Map<ts.ArrowFunction | ts.FunctionExpression, Set<string>>()
  let currentMockFactory: ts.ArrowFunction | ts.FunctionExpression | undefined

  function requireMockHelper(name: 'withSelectorKey' | 'withSelectorKeyProps') {
    if (!currentMockFactory) {
      neededSelectorMockImports.add(name)
      return
    }

    const imports = mockFactoryImports.get(currentMockFactory) ?? new Set<string>()
    imports.add(name)
    mockFactoryImports.set(currentMockFactory, imports)
  }

  function isSelectorMockAdapter(expression: ts.Expression) {
    const adapter = unwrapExpression(expression)
    if (!ts.isArrowFunction(adapter) && !ts.isFunctionExpression(adapter))
      return false

    const selectorParameter = adapter.parameters[0]
    return Boolean(selectorParameter?.type && hasSelectorType(selectorParameter.type))
      || /\b(?:keyFromSelector|resolveI18nKey)\s*\(/.test(adapter.body.getText(sourceFile))
  }

  function addMockTEdit(node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment) {
    if (mockEditStarts.has(node.getStart(sourceFile)))
      return

    if (ts.isPropertyAssignment(node)) {
      const initializer = unwrapExpression(node.initializer)
      if (isSelectorMockAdapter(initializer))
        return

      const alreadyWrapped = ts.isCallExpression(initializer)
        && ts.isIdentifier(initializer.expression)
        && initializer.expression.text === 'withSelectorKey'
      if (alreadyWrapped)
        return

      const translate = currentMockFactory && ts.isIdentifier(initializer)
        ? `(...args: Parameters<typeof ${initializer.text}>) => ${initializer.text}(...args)`
        : node.initializer.getText(sourceFile)

      edits.push({
        end: node.initializer.end,
        replacement: `withSelectorKey(${translate})`,
        start: node.initializer.getStart(sourceFile),
      })
    }
    else {
      const translate = currentMockFactory
        ? `(...args: Parameters<typeof ${node.name.text}>) => ${node.name.text}(...args)`
        : node.name.text
      edits.push({
        end: node.end,
        replacement: `t: withSelectorKey(${translate})`,
        start: node.getStart(sourceFile),
      })
    }

    mockEditStarts.add(node.getStart(sourceFile))
    requireMockHelper('withSelectorKey')
  }

  function addMockTransEdit(node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment) {
    if (mockEditStarts.has(node.getStart(sourceFile)))
      return

    if (ts.isPropertyAssignment(node)) {
      const initializer = unwrapExpression(node.initializer)
      const alreadyWrapped = ts.isCallExpression(initializer)
        && ts.isIdentifier(initializer.expression)
        && initializer.expression.text === 'withSelectorKeyProps'
      if (alreadyWrapped)
        return

      const render = currentMockFactory && ts.isIdentifier(initializer)
        ? `(props: Parameters<typeof ${initializer.text}>[0]) => withSelectorKeyProps(${initializer.text})(props)`
        : `withSelectorKeyProps(${node.initializer.getText(sourceFile)})`

      edits.push({
        end: node.initializer.end,
        replacement: render,
        start: node.initializer.getStart(sourceFile),
      })
    }
    else {
      const render = currentMockFactory
        ? `(props: Parameters<typeof ${node.name.text}>[0]) => withSelectorKeyProps(${node.name.text})(props)`
        : `withSelectorKeyProps(${node.name.text})`
      edits.push({
        end: node.end,
        replacement: `Trans: ${render}`,
        start: node.getStart(sourceFile),
      })
    }

    mockEditStarts.add(node.getStart(sourceFile))
    requireMockHelper('withSelectorKeyProps')
  }

  function collectReturnedExpressions(node: ts.FunctionLikeDeclaration, collect: (expression: ts.Expression) => void) {
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      collect(node.body)
      return
    }

    if (!node.body)
      return

    function visitReturn(candidate: ts.Node) {
      if (candidate !== node && ts.isFunctionLike(candidate))
        return
      if (ts.isReturnStatement(candidate) && candidate.expression) {
        collect(candidate.expression)
        return
      }
      ts.forEachChild(candidate, visitReturn)
    }

    visitReturn(node.body)
  }

  function followLocalIdentifier(
    identifier: ts.Identifier,
    visitedSymbols: Set<ts.Symbol>,
    collect: (node: ts.Node) => void,
  ) {
    const symbol = checker.getSymbolAtLocation(identifier)
    if (!symbol || visitedSymbols.has(symbol))
      return symbol
    visitedSymbols.add(symbol)

    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer)
        collect(declaration.initializer)
      else if (ts.isFunctionDeclaration(declaration))
        collect(declaration)
    }
    return symbol
  }

  function collectMockProviderValue(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      const symbol = followLocalIdentifier(node, visitedMockProviderSymbols, collectMockProviderValue)
      if (symbol)
        mockProviderSymbols.add(symbol)
      return
    }

    if (ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node)
      || ts.isNonNullExpression(node)
      || ts.isSatisfiesExpression(node)
      || ts.isTypeAssertionExpression(node)) {
      collectMockProviderValue(node.expression)
      return
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      collectReturnedExpressions(node, collectMockProviderValue)
      return
    }

    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && getPropertyName(property) === 't')
          addMockTEdit(property)
        else if (ts.isShorthandPropertyAssignment(property) && property.name.text === 't')
          addMockTEdit(property)
        else if (ts.isSpreadAssignment(property))
          collectMockProviderValue(property.expression)
      }
      return
    }

    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const symbol = followLocalIdentifier(node.expression, visitedMockProviderSymbols, collectMockProviderValue)
        if (symbol)
          mockProviderSymbols.add(symbol)
      }
      if (isVitestValueWrapper(node)) {
        for (const argument of node.arguments)
          collectMockProviderValue(argument)
      }
      return
    }

    if (ts.isConditionalExpression(node)) {
      collectMockProviderValue(node.whenTrue)
      collectMockProviderValue(node.whenFalse)
      return
    }

    if (ts.isAwaitExpression(node))
      collectMockProviderValue(node.expression)
  }

  function collectMockModuleValue(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      followLocalIdentifier(node, visitedMockModuleSymbols, collectMockModuleValue)
      return
    }

    if (ts.isParenthesizedExpression(node)
      || ts.isAsExpression(node)
      || ts.isNonNullExpression(node)
      || ts.isSatisfiesExpression(node)
      || ts.isTypeAssertionExpression(node)) {
      collectMockModuleValue(node.expression)
      return
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
      collectReturnedExpressions(node, collectMockModuleValue)
      return
    }

    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        const propertyName = getPropertyName(property)
        if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && propertyName === 't') {
          addMockTEdit(property)
        }
        else if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && propertyName === 'Trans') {
          addMockTransEdit(property)
        }
        else if (propertyName === 'useTranslation' || propertyName === 'getI18n') {
          if (ts.isPropertyAssignment(property))
            collectMockProviderValue(property.initializer)
          else if (ts.isShorthandPropertyAssignment(property))
            collectMockProviderValue(property.name)
          else if (ts.isMethodDeclaration(property))
            collectMockProviderValue(property)
        }
        else if (ts.isSpreadAssignment(property)) {
          collectMockModuleValue(property.expression)
        }
      }
      return
    }

    if (ts.isCallExpression(node)) {
      if (isVitestValueWrapper(node)) {
        for (const argument of node.arguments)
          collectMockModuleValue(argument)
      }
      return
    }

    if (ts.isConditionalExpression(node)) {
      collectMockModuleValue(node.whenTrue)
      collectMockModuleValue(node.whenFalse)
      return
    }

    if (ts.isAwaitExpression(node))
      collectMockModuleValue(node.expression)
  }

  function collectConfiguredMockProviderValues(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = unwrapExpression(node.expression.expression)
      const methodName = node.expression.name.text
      const receiverSymbol = ts.isIdentifier(receiver) ? checker.getSymbolAtLocation(receiver) : undefined
      if (ts.isIdentifier(receiver)
        && MOCK_PROVIDER_METHODS.has(methodName)
        && receiverSymbol
        && mockProviderSymbols.has(receiverSymbol)) {
        const value = node.arguments[0]
        if (value)
          collectMockProviderValue(value)
      }
    }
    ts.forEachChild(node, collectConfiguredMockProviderValues)
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isI18nMock(node)) {
      const factory = node.arguments[1]
      if (factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
        const previousMockFactory = currentMockFactory
        currentMockFactory = factory
        collectMockModuleValue(factory)
        currentMockFactory = previousMockFactory
      }
      else if (factory) {
        collectMockModuleValue(factory)
      }
    }

    if (ts.isCallExpression(node) && isTranslationCall(node, checker, sourceFile) && node.arguments.length) {
      const keyExpression = node.arguments[0]! as ts.Expression
      if (!isSelectorCompatibleExpression(keyExpression, checker, sourceFile)) {
        edits.push({
          end: keyExpression.end,
          replacement: selectorFor(keyExpression, sourceFile),
          start: keyExpression.getStart(sourceFile),
        })
      }

      const fallback = node.arguments[1]
      if (fallback && isStringExpression(fallback)) {
        const options = node.arguments[2]
        if (options && ts.isObjectLiteralExpression(unwrapExpression(options as ts.Expression))) {
          const optionsText = options.getText(sourceFile)
          const properties = optionsText.slice(1, -1).trim()
          edits.push({
            end: options.end,
            replacement: `{ defaultValue: ${fallback.getText(sourceFile)}${properties ? `, ${properties}` : ''} }`,
            start: fallback.getStart(sourceFile),
          })
        }
        else if (!options) {
          edits.push({
            end: fallback.end,
            replacement: `{ defaultValue: ${fallback.getText(sourceFile)} }`,
            start: fallback.getStart(sourceFile),
          })
        }
      }
    }

    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (ts.isIdentifier(node.tagName) && isTransComponent(node.tagName, checker)) {
        const attribute = getJsxAttribute(node, 'i18nKey')
        const initializer = attribute?.initializer
        if (initializer && ts.isStringLiteral(initializer)) {
          edits.push({
            end: initializer.end,
            replacement: `{$ => $[${initializer.getText(sourceFile)}]}`,
            start: initializer.getStart(sourceFile),
          })
        }
        else if (initializer && ts.isJsxExpression(initializer) && initializer.expression) {
          if (!isSelectorCompatibleExpression(initializer.expression, checker, sourceFile)) {
            edits.push({
              end: initializer.expression.end,
              replacement: selectorFor(initializer.expression, sourceFile),
              start: initializer.expression.getStart(sourceFile),
            })
          }
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  collectConfiguredMockProviderValues(sourceFile)
  for (const [factory, helperNames] of mockFactoryImports) {
    const helpers = Array.from(helperNames).sort()
    const body = factory.body
    const alreadyLoadsHelpers = ts.isBlock(body) && body.statements.some((statement) => {
      return ts.isVariableStatement(statement)
        && statement.getText(sourceFile).includes(`import('@/test/i18n-mock')`)
    })
    if (alreadyLoadsHelpers)
      continue

    const isAsync = factory.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)
    if (!isAsync) {
      edits.push({
        end: factory.getStart(sourceFile),
        replacement: 'async ',
        start: factory.getStart(sourceFile),
      })
    }

    const { character: factoryColumn } = sourceFile.getLineAndCharacterOfPosition(factory.getStart(sourceFile))
    const factoryLineStart = factory.getStart(sourceFile) - factoryColumn
    const leadingWhitespace = source.slice(factoryLineStart, factory.getStart(sourceFile)).match(/^\s*/)?.[0].length ?? 0
    const bodyIndent = ' '.repeat(leadingWhitespace + 2)
    const closingIndent = ' '.repeat(leadingWhitespace)
    const helperImport = `const { ${helpers.join(', ')} } = await import('@/test/i18n-mock')`
    if (ts.isBlock(body)) {
      edits.push({
        end: body.getStart(sourceFile) + 1,
        replacement: `\n${bodyIndent}${helperImport}`,
        start: body.getStart(sourceFile) + 1,
      })
    }
    else {
      const bodyStart = body.getStart(sourceFile)
      const nestedEdits = edits.filter(edit => edit.start >= bodyStart && edit.end <= body.end)
      const transformedBody = applyEdits(
        source.slice(bodyStart, body.end),
        nestedEdits.map(edit => ({
          ...edit,
          end: edit.end - bodyStart,
          start: edit.start - bodyStart,
        })),
      )
      for (const edit of nestedEdits)
        consumedEdits.add(edit)

      const indentedBody = transformedBody
        .split('\n')
        .map((line, index) => index === 0 || line.trim() === '' ? line.trimEnd() : `  ${line}`)
        .join('\n')
      edits.push({
        end: body.end,
        replacement: `{\n${bodyIndent}${helperImport}\n${bodyIndent}return ${indentedBody}\n${closingIndent}}`,
        start: bodyStart,
      })
    }
  }
  if (neededSelectorMockImports.size) {
    const imports = sourceFile.statements.filter(ts.isImportDeclaration)
    const helperImport = imports.find((node) => {
      return ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === '@/test/i18n-mock'
    })
    const namedBindings = helperImport?.importClause?.namedBindings
    const existingNames = namedBindings && ts.isNamedImports(namedBindings)
      ? namedBindings.elements.map(element => element.name.text)
      : []
    const missingNames = Array.from(neededSelectorMockImports).filter(name => !existingNames.includes(name))

    if (missingNames.length && namedBindings && ts.isNamedImports(namedBindings)) {
      edits.push({
        end: namedBindings.end,
        replacement: `{ ${[...existingNames, ...missingNames].join(', ')} }`,
        start: namedBindings.getStart(sourceFile),
      })
    }
    else if (missingNames.length) {
      const lastImport = imports.at(-1)
      const position = lastImport?.end ?? 0
      const prefix = position ? '\n' : ''
      edits.push({
        end: position,
        replacement: `${prefix}import { ${missingNames.join(', ')} } from '@/test/i18n-mock'`,
        start: position,
      })
    }
  }

  return {
    changes: edits.length,
    output: applyEdits(source, edits.filter(edit => !consumedEdits.has(edit))),
  }
}

async function listSourceFiles(root: string) {
  const files: string[] = []

  async function walk(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name))
        continue

      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory())
        await walk(entryPath)
      else if (entry.isFile() && !SKIPPED_FILES.has(entry.name) && SOURCE_EXTENSIONS.has(path.extname(entry.name)))
        files.push(entryPath)
    }
  }

  await walk(root)
  return files.sort()
}

function createProjectProgram(root: string) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json')
  if (!configPath)
    return undefined

  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error)
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), {
    incremental: false,
    noEmit: true,
  }, configPath)
  if (parsed.errors.length)
    throw new Error(ts.flattenDiagnosticMessageText(parsed.errors[0]!.messageText, '\n'))

  return ts.createProgram({
    options: parsed.options,
    rootNames: parsed.fileNames,
  })
}

export async function migrateSelectors(root: string, write: boolean) {
  const files = await listSourceFiles(root)
  const projectProgram = createProjectProgram(root)
  const projectChecker = projectProgram?.getTypeChecker()
  const changedFilePaths: string[] = []
  let changedFiles = 0
  let changes = 0

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    const projectSourceFile = projectProgram?.getSourceFile(path.resolve(file))
    const result = projectSourceFile && projectChecker && projectSourceFile.text === source
      ? transformAnalyzedSource(source, projectSourceFile, projectChecker)
      : transformSource(source, file)
    if (!result.changes)
      continue

    changedFiles++
    changedFilePaths.push(file)
    changes += result.changes
    if (write)
      await fs.writeFile(file, result.output, 'utf8')
  }

  return { changedFilePaths, changedFiles, changes }
}

async function runCli() {
  const write = process.argv.includes('--write')
  const verbose = process.argv.includes('--verbose')
  const unknownArgs = process.argv.slice(2).filter(arg => arg !== '--verbose' && arg !== '--write')
  if (unknownArgs.length)
    throw new Error(`Unknown arguments: ${unknownArgs.join(', ')}`)

  const result = await migrateSelectors(process.cwd(), write)
  const action = write ? 'Migrated' : 'Found'
  console.log(`${action} ${result.changes} i18n selector call sites across ${result.changedFiles} files.`)
  if (verbose) {
    for (const file of result.changedFilePaths)
      console.log(path.relative(process.cwd(), file))
  }
  if (!write && result.changes)
    process.exitCode = 1
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === entryPath) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
