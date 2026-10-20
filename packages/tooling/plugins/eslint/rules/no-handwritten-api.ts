import type { TSESLint, TSESTree } from '@typescript-eslint/utils'
import type { Rule } from 'eslint'
import path from 'node:path'

const baseHelpers = new Set([
  'get',
  'post',
  'put',
  'patch',
  'del',
  'request',
  'getPublic',
  'postPublic',
  'putPublic',
  'patchPublic',
  'delPublic',
  'getMarketplace',
  'postMarketplace',
  'upload',
  'sseGet',
  'ssePost',
  'sseGeneratorPost',
])
const httpPackages = new Set([
  'axios',
  'ky',
  'ofetch',
  'node-fetch',
  'cross-fetch',
  'isomorphic-fetch',
  'undici',
  'superagent',
])
const httpMethods = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'del',
  'head',
  'options',
  'request',
  'fetch',
  '$fetch',
  'ofetch',
  'create',
  'extend',
  'Client',
  'Pool',
  'Agent',
])
type Origin = { kind: 'base' | 'fetch' | 'http' | 'global'; members: string[] }

function unwrap(node: TSESTree.Node): TSESTree.Node {
  while (
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TSTypeAssertion',
      'ChainExpression',
      'AwaitExpression',
    ].includes(node.type) &&
    ('expression' in node || 'argument' in node)
  ) {
    if ('expression' in node && typeof node.expression !== 'boolean') node = node.expression
    else if ('argument' in node && node.argument) node = node.argument
    else break
  }
  return node
}

function propertyName(node: TSESTree.Node, computed: boolean): string | undefined {
  if (node.type === 'Identifier' && !computed) return node.name
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
}

function variableAt(sourceCode: TSESLint.SourceCode, node: TSESTree.Identifier) {
  let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(node)
  while (scope) {
    const variable = scope.set.get(node.name)
    if (variable) return variable
    scope = scope.upper
  }
}

function isTransport(origin: Origin | undefined): boolean {
  if (!origin) return false
  const { kind, members } = origin
  if (kind === 'global')
    return members.length === 1 && ['fetch', 'XMLHttpRequest'].includes(members[0]!)
  if (kind === 'base') return members.length === 1 && baseHelpers.has(members[0]!)
  if (kind === 'fetch')
    return (
      (members.length === 1 && ['base', 'postWithKeepalive'].includes(members[0]!)) ||
      (members.length === 2 && members[0] === 'base' && members[1] === 'fetch')
    )
  return !members.length || httpMethods.has(members.at(-1)!)
}

const rule: TSESLint.RuleModule<'handwritten', []> = {
  meta: {
    type: 'problem',
    docs: { description: 'Prevent new handwritten HTTP calls in Web production code.' },
    schema: [],
    messages: {
      handwritten:
        'Use a generated consoleClient / consoleQuery (or marketplace client) instead of handwritten HTTP. A special transport needs a scoped exception explaining its contract.',
    },
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode
    const filename = context.filename.replaceAll('\\', '/')

    function moduleOrigin(source: string): Origin | undefined {
      if (httpPackages.has(source.split('/')[0]!)) return { kind: 'http', members: [] }
      const resolved = (
        source.startsWith('@/')
          ? `web/${source.slice(2)}`
          : path.resolve(path.dirname(filename), source)
      )
        .replaceAll('\\', '/')
        .replace(/\.(?:[cm]?ts|[cm]?js)x?$/, '')
      if (/(?:^|\/)web\/service\/base(?:\/index)?$/.test(resolved))
        return { kind: 'base', members: [] }
      if (/(?:^|\/)web\/service\/fetch(?:\/index)?$/.test(resolved))
        return { kind: 'fetch', members: [] }
    }

    function resolve(node: TSESTree.Node, seen = new Set<TSESTree.Node>()): Origin | undefined {
      node = unwrap(node)
      if (seen.has(node)) return
      seen.add(node)
      if (node.type === 'MemberExpression') {
        const origin = resolve(node.object, seen)
        const member = propertyName(node.property, node.computed)
        if (origin && member !== undefined)
          return { ...origin, members: [...origin.members, member] }
      }
      if (
        node.type === 'ImportExpression' &&
        node.source.type === 'Literal' &&
        typeof node.source.value === 'string'
      )
        return moduleOrigin(node.source.value)
      if (node.type === 'CallExpression') {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          !variableAt(sourceCode, node.callee)?.defs.length &&
          node.arguments[0]?.type === 'Literal' &&
          typeof node.arguments[0].value === 'string'
        )
          return moduleOrigin(node.arguments[0].value)
        const callee = unwrap(node.callee)
        if (callee.type === 'MemberExpression') {
          const member = propertyName(callee.property, callee.computed)
          const owner = resolve(callee.object, seen)
          // Preserve provenance through bound fetch helpers and HTTP client factories.
          if (owner && member === 'bind') return owner
          if (owner?.kind === 'http' && (member === 'create' || member === 'extend'))
            return { kind: 'http', members: [] }
        }
      }
      if (node.type !== 'Identifier') return
      const variable = variableAt(sourceCode, node)
      const definition = variable?.defs[0]
      if (!definition) {
        if (['globalThis', 'window', 'self'].includes(node.name))
          return { kind: 'global', members: [] }
        if (['fetch', 'XMLHttpRequest'].includes(node.name))
          return { kind: 'global', members: [node.name] }
        return
      }
      if (definition.type === 'ImportBinding' && definition.parent.type === 'ImportDeclaration') {
        const origin = moduleOrigin(definition.parent.source.value)
        if (!origin) return
        const specifier = definition.node
        if (specifier.type === 'ImportNamespaceSpecifier') return origin
        if (specifier.type === 'ImportDefaultSpecifier')
          return origin.kind === 'http' ? origin : undefined
        if (specifier.type !== 'ImportSpecifier') return
        return {
          ...origin,
          members: [propertyName(specifier.imported, false)!],
        }
      }
      if (definition.type === 'Variable' && definition.node.init) {
        const origin = resolve(definition.node.init, seen)
        if (!origin) return
        if (definition.node.id.type === 'Identifier') return origin
        if (definition.node.id.type === 'ObjectPattern') {
          const property = definition.node.id.properties.find(
            (entry) =>
              entry.type === 'Property' &&
              entry.value.type === 'Identifier' &&
              entry.value.name === node.name,
          )
          if (property?.type === 'Property') {
            const member = propertyName(property.key, property.computed)
            if (member !== undefined) return { ...origin, members: [...origin.members, member] }
          }
        }
      }
    }

    function checkCall(node: TSESTree.CallExpression | TSESTree.NewExpression) {
      let callee = unwrap(node.callee)
      if (
        callee.type === 'MemberExpression' &&
        ['call', 'apply', 'bind'].includes(propertyName(callee.property, callee.computed) ?? '')
      )
        callee = unwrap(callee.object)
      if (isTransport(resolve(callee))) context.report({ node, messageId: 'handwritten' })
    }

    return {
      CallExpression: checkCall,
      NewExpression: checkCall,
      // Do not let a new barrel hide the transport from call-site checks.
      ExportNamedDeclaration(node) {
        if (!node.source || node.exportKind === 'type') return
        const origin = moduleOrigin(node.source.value)
        if (!origin) return
        for (const specifier of node.specifiers) {
          if (specifier.exportKind === 'type') continue
          if (isTransport({ ...origin, members: [propertyName(specifier.local, false)!] }))
            context.report({ node: specifier, messageId: 'handwritten' })
        }
      },
      ExportAllDeclaration(node) {
        if (node.exportKind !== 'type' && moduleOrigin(node.source.value))
          context.report({ node, messageId: 'handwritten' })
      },
    }
  },
}

export default rule as unknown as Rule.RuleModule
