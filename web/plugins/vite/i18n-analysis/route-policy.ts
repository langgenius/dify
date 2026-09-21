import path from 'node:path'
import * as ts from 'typescript'
import { createTranslationApiResolver } from './api'
import { createLocalDataflow } from './dataflow'

export type RouteNamespacePolicy = { module: string; exportedName: string }

// An explicit config contract supplies route values. This proves only the local
// dataflow to that policy function, not arbitrary router or policy implementations.
export function createRoutePolicyMatcher(
  root: string,
  checker: ts.TypeChecker,
  policy?: RouteNamespacePolicy,
) {
  if (!policy) return (_expression: ts.Expression) => false
  const exportedName = policy.exportedName
  const expected = path.resolve(root, policy.module).replaceAll('\\', '/')
  const jsx = new Map<ts.FunctionDeclaration, (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[]>()
  const references = new Map<ts.FunctionDeclaration, ts.Identifier[]>()
  const written = new Set<ts.Symbol>()
  const translationApi = createTranslationApiResolver(root, checker)
  function declarations(node: ts.Node) {
    const symbol = checker.getSymbolAtLocation(node)
    return symbol?.flags && symbol.flags & ts.SymbolFlags.Alias
      ? (checker.getAliasedSymbol(symbol).declarations ?? [])
      : (symbol?.declarations ?? [])
  }
  const dataflow = createLocalDataflow(declarations)
  const markWritten = dataflow.createReferenceVisitor({
    stop: (node) => ts.isCallExpression(node) || ts.isFunctionLike(node),
    visit: (node) => {
      if (!ts.isIdentifier(node)) return
      const symbol = checker.getSymbolAtLocation(node)
      if (symbol) written.add(symbol)
    },
  })
  function isReactEffect(expression: ts.Expression) {
    const symbol = checker.getSymbolAtLocation(expression)
    return (
      symbol?.declarations?.some((declaration) => {
        if (
          !ts.isImportSpecifier(declaration) ||
          !['useEffect', 'useLayoutEffect', 'useInsertionEffect'].includes(
            (declaration.propertyName ?? declaration.name).text,
          )
        )
          return false
        const module = declaration.parent.parent.parent.moduleSpecifier
        return ts.isStringLiteral(module) && module.text === 'react'
      }) ?? false
    )
  }
  const indexed = new Set<ts.SourceFile>()
  function indexSource(source: ts.SourceFile) {
    if (indexed.has(source)) return
    indexed.add(source)
    function visit(node: ts.Node) {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      )
        markWritten(node.left)
      if (
        ts.isCallExpression(node) &&
        (ts.isPropertyAccessExpression(node.expression) ||
          ts.isElementAccessExpression(node.expression))
      ) {
        const access = node.expression
        const method = ts.isPropertyAccessExpression(access)
          ? access.name.text
          : ts.isStringLiteralLike(access.argumentExpression)
            ? access.argumentExpression.text
            : undefined
        if (
          !method ||
          /^(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)$/.test(method)
        )
          markWritten(access.expression)
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const api = translationApi(node.expression)
        if (api !== 'useTranslation' && api !== 'getTranslation')
          for (const [index, argument] of (node.arguments ?? []).entries()) {
            // React reads effect dependencies for comparison; it does not mutate their values.
            if (index === 1 && ts.isCallExpression(node) && isReactEffect(node.expression)) continue
            markWritten(argument)
          }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        for (const declaration of declarations(node.tagName)) {
          if (!ts.isFunctionDeclaration(declaration)) continue
          const uses = jsx.get(declaration) ?? []
          uses.push(node)
          jsx.set(declaration, uses)
        }
      }
      if (ts.isIdentifier(node)) {
        for (const declaration of declarations(node)) {
          if (!ts.isFunctionDeclaration(declaration)) continue
          const uses = references.get(declaration) ?? []
          uses.push(node)
          references.set(declaration, uses)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  function matches(expression: ts.Expression, seen = new Set<ts.Node>()): boolean {
    indexSource(expression.getSourceFile())
    if (seen.has(expression)) return false
    const next = new Set(seen).add(expression)
    if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isNonNullExpression(expression)
    )
      return matches(expression.expression, next)
    if (ts.isSpreadElement(expression)) return matches(expression.expression, next)
    if (ts.isArrayLiteralExpression(expression))
      return (
        expression.elements.length > 0 &&
        expression.elements.every((element) => matches(element, next))
      )
    if (ts.isCallExpression(expression)) {
      const policyCall = declarations(expression.expression).some(
        (declaration) =>
          ts.isFunctionDeclaration(declaration) &&
          declaration.name?.text === exportedName &&
          declaration.getSourceFile().fileName.replaceAll('\\', '/') === expected,
      )
      const pathname = expression.arguments[0]
      if (!policyCall || !pathname || !ts.isCallExpression(pathname)) return false
      const symbol = checker.getSymbolAtLocation(pathname.expression)
      return !!symbol?.declarations?.some((declaration) => {
        if (
          !ts.isImportSpecifier(declaration) ||
          (declaration.propertyName ?? declaration.name).text !== 'usePathname'
        )
          return false
        const module = declaration.parent.parent.parent.moduleSpecifier
        return (
          ts.isStringLiteral(module) &&
          ['@/next/navigation', 'next/navigation'].includes(module.text)
        )
      })
    }
    if (!ts.isIdentifier(expression)) return false
    const symbol = checker.getSymbolAtLocation(expression)
    if (symbol && written.has(symbol)) return false
    const values = declarations(expression)
    return (
      values.length > 0 &&
      values.every((declaration) => {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer)
          return matches(declaration.initializer, next)
        if (
          !ts.isBindingElement(declaration) ||
          declaration.initializer ||
          declaration.dotDotDotToken
        )
          return false
        const parameter = declaration.parent.parent
        if (
          !ts.isParameter(parameter) ||
          parameter.initializer ||
          !ts.isFunctionDeclaration(parameter.parent)
        )
          return false
        const owner = parameter.parent
        if (owner.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
          return false
        const uses = jsx.get(owner) ?? []
        if (
          !uses.length ||
          !(references.get(owner) ?? []).every(
            (reference) =>
              reference === owner.name ||
              ((ts.isJsxOpeningElement(reference.parent) ||
                ts.isJsxSelfClosingElement(reference.parent) ||
                ts.isJsxClosingElement(reference.parent)) &&
                reference.parent.tagName === reference),
          )
        )
          return false
        const property = (declaration.propertyName ?? declaration.name).getText()
        return uses.every((use) => {
          if (use.attributes.properties.some((attribute) => ts.isJsxSpreadAttribute(attribute)))
            return false
          const attributes = use.attributes.properties.filter(
            (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === property,
          )
          if (attributes.length !== 1) return false
          const attribute = attributes[0]!
          return (
            ts.isJsxAttribute(attribute) &&
            !!attribute.initializer &&
            ts.isJsxExpression(attribute.initializer) &&
            !!attribute.initializer.expression &&
            matches(attribute.initializer.expression, next)
          )
        })
      })
    )
  }
  return matches
}
