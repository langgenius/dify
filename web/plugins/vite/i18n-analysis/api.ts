import path from 'node:path'
import * as ts from 'typescript'

type TranslationApi = 'useTranslation' | 'getTranslation' | 'Trans'

export function createTranslationApiResolver(root: string, checker: ts.TypeChecker) {
  const known = (name: string, module: string): TranslationApi | undefined => {
    if (module === 'react-i18next' && (name === 'useTranslation' || name === 'Trans')) return name
    if (
      (module === '#i18n' || /^@\/i18n\/lib(?:\.client|\.server)?$/.test(module)) &&
      name === 'useTranslation'
    )
      return name
    if (module === '@/i18n/server' && name === 'getTranslation') return name
  }
  const cache = new Map<ts.Node, TranslationApi | undefined>()
  function resolve(node: ts.Node, seen = new Set<ts.Node>()): TranslationApi | undefined {
    if (cache.has(node)) return cache.get(node)
    if (seen.has(node)) return
    const next = new Set(seen).add(node)
    const symbol = checker.getSymbolAtLocation(
      ts.isPropertyAccessExpression(node) ? node.name : node,
    )
    const declarations = symbol?.declarations ?? []
    for (const declaration of declarations) {
      if (ts.isImportSpecifier(declaration)) {
        const module = declaration.parent.parent.parent.moduleSpecifier
        if (ts.isStringLiteral(module)) {
          const api = known((declaration.propertyName ?? declaration.name).text, module.text)
          if (api) return api
        }
      }
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const api = resolve(declaration.initializer, next)
        if (api) return api
      }
    }
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      for (const declaration of checker.getAliasedSymbol(symbol).declarations ?? []) {
        const api = resolveDeclaration(declaration)
        if (api) return api
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
          const aliased = resolve(declaration.initializer, next)
          if (aliased) return aliased
        }
      }
    }
    for (const declaration of declarations) {
      const api = resolveDeclaration(declaration)
      if (api) return api
    }
    if (ts.isPropertyAccessExpression(node)) {
      for (const declaration of checker.getSymbolAtLocation(node.expression)?.declarations ?? []) {
        if (ts.isNamespaceImport(declaration)) {
          const module = declaration.parent.parent.moduleSpecifier
          if (ts.isStringLiteral(module)) {
            const api = known(node.name.text, module.text)
            if (api) return api
          }
        }
      }
    }
  }
  function resolveDeclaration(declaration: ts.Declaration): TranslationApi | undefined {
    const file = declaration.getSourceFile().fileName.replaceAll('\\', '/')
    const relative = path.relative(root, file).replaceAll('\\', '/')
    const name =
      (ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)) &&
      declaration.name &&
      ts.isIdentifier(declaration.name)
        ? declaration.name.text
        : undefined
    if (name === 'useTranslation' && /^i18n\/lib(?:\.client|\.server)?\.tsx?$/.test(relative))
      return name
    if (name === 'getTranslation' && relative === 'i18n/server.ts') return name
    if (
      file.includes('/node_modules/react-i18next/') &&
      (name === 'useTranslation' || name === 'Trans')
    )
      return name
  }
  return (node: ts.Node) => {
    if (!cache.has(node)) cache.set(node, resolve(node))
    return cache.get(node)
  }
}
