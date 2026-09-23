import path from 'node:path'
import * as ts from 'typescript'

export type TranslationAdapter = {
  /** Source module path, relative to the Vite root. */
  module: string
  exportName: string
  namespaceArgument: number
  /** Omit for APIs returning a translation object with a t function. */
  selectorArgument?: number
  /** Additional private forwarding functions in the same source module. */
  implementationFunctions?: readonly string[]
}

type TranslationApi =
  | { kind: 'translation'; namespaceArgument: number; selectorArgument?: number }
  | { kind: 'trans' }

function declarationIdentity(root: string, node: ts.Node) {
  if (
    (!ts.isFunctionDeclaration(node) && !ts.isVariableDeclaration(node)) ||
    !node.name ||
    !ts.isIdentifier(node.name)
  )
    return
  return {
    module: path.relative(root, node.getSourceFile().fileName).replaceAll('\\', '/'),
    name: node.name.text,
  }
}

export function createTranslationApiResolver(
  root: string,
  program: ts.Program,
  adapters: readonly TranslationAdapter[],
) {
  const checker = program.getTypeChecker()
  const exportedAdapters = new Map<ts.Node, TranslationAdapter>()
  for (const adapter of adapters) {
    const source = program.getSourceFile(path.resolve(root, adapter.module))
    const module = source && checker.getSymbolAtLocation(source)
    const exported =
      module &&
      checker.getExportsOfModule(module).find((symbol) => symbol.name === adapter.exportName)
    if (!exported) continue
    const target =
      exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    for (const declaration of target.declarations ?? []) exportedAdapters.set(declaration, adapter)
  }
  function isAdapter(node: ts.Node) {
    if (exportedAdapters.has(node)) return true
    const identity = declarationIdentity(root, node)
    return (
      !!identity &&
      adapters.some(
        (adapter) =>
          adapter.module === identity.module &&
          adapter.implementationFunctions?.includes(identity.name),
      )
    )
  }
  const known = (name: string, module: string): TranslationApi | undefined => {
    if (module !== 'react-i18next') return
    if (name === 'useTranslation') return { kind: 'translation', namespaceArgument: 0 }
    if (name === 'Trans') return { kind: 'trans' }
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
  }
  function resolveDeclaration(declaration: ts.Declaration): TranslationApi | undefined {
    const file = declaration.getSourceFile().fileName.replaceAll('\\', '/')
    const identity = declarationIdentity(root, declaration)
    const adapter = exportedAdapters.get(declaration)
    if (adapter)
      return {
        kind: 'translation',
        namespaceArgument: adapter.namespaceArgument,
        selectorArgument: adapter.selectorArgument,
      }
    if (file.includes('/node_modules/react-i18next/') && identity)
      return known(identity.name, 'react-i18next')
  }

  return {
    isAdapter,
    resolve(node: ts.Node) {
      if (!cache.has(node)) cache.set(node, resolve(node))
      return cache.get(node)
    },
  }
}
