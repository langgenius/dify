import path from 'node:path'

const webRoot = path.resolve(import.meta.dirname, '../../..')
const appStorePath = path.join(webRoot, 'app/components/app/store')

function isAppStore(source, filename) {
  if (typeof source !== 'string') return false
  const modulePath = source.replace(/[?#].*$/u, '')
  let resolved
  if (modulePath.startsWith('@/') || modulePath.startsWith('~@/')) {
    resolved = path.resolve(webRoot, modulePath.replace(/^~?@\//u, ''))
  } else if (modulePath.startsWith('.') || path.isAbsolute(modulePath)) {
    resolved = path.resolve(path.dirname(filename), modulePath)
  } else {
    return false
  }
  return resolved.replace(/\.(?:[cm]?[jt]s|[jt]sx)$/u, '') === appStorePath
}

function isUnshadowedRequire(sourceCode, node) {
  if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return false
  let scope = sourceCode.getScope(node)
  while (scope) {
    const variable = scope.set.get('require')
    if (variable) return variable.defs.length === 0
    scope = scope.upper
  }
  return true
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow imports and re-exports of the legacy app detail store.',
    },
    schema: [],
    messages: {
      legacyAppStore:
        'Do not import the legacy app store. Read app details through generated consoleQuery APIs keyed by appId, and keep UI state in the owning feature.',
    },
  },
  create(context) {
    function checkSource(source) {
      if (source && isAppStore(source.value, context.filename)) {
        context.report({ node: source, messageId: 'legacyAppStore' })
      }
    }

    return {
      ImportDeclaration(node) {
        checkSource(node.source)
      },
      ExportNamedDeclaration(node) {
        checkSource(node.source)
      },
      ExportAllDeclaration(node) {
        checkSource(node.source)
      },
      ImportExpression(node) {
        checkSource(node.source)
      },
      TSImportType(node) {
        checkSource(node.source)
      },
      TSExternalModuleReference(node) {
        checkSource(node.expression)
      },
      CallExpression(node) {
        if (isUnshadowedRequire(context.sourceCode, node)) checkSource(node.arguments[0])
      },
    }
  },
}
