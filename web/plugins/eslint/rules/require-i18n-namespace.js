const translationModules = new Set(['react-i18next', '#i18n'])

function unwrap(node) {
  while (
    node &&
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TSTypeAssertion',
      'ParenthesizedExpression',
      'ChainExpression',
    ].includes(node.type)
  )
    node = node.expression
  return node
}

function getVariable(sourceCode, node) {
  let scope = sourceCode.getScope(node)
  while (scope) {
    const variable = scope.set.get(node.name)
    if (variable) return variable
    scope = scope.upper
  }
}

function isTranslationHook(sourceCode, callee) {
  callee = unwrap(callee)
  let identifier = callee
  let namespaceImport = false
  if (callee.type === 'MemberExpression') {
    const property = callee.computed ? callee.property.value : callee.property.name
    if (property !== 'useTranslation') return false
    identifier = unwrap(callee.object)
    namespaceImport = true
  }
  if (identifier.type !== 'Identifier') return false
  const definition = getVariable(sourceCode, identifier)?.defs[0]
  if (
    definition?.type !== 'ImportBinding' ||
    !translationModules.has(definition.parent.source.value)
  )
    return false
  if (namespaceImport) return definition.node.type === 'ImportNamespaceSpecifier'
  return (
    definition.node.type === 'ImportSpecifier' &&
    (definition.node.imported.name ?? definition.node.imported.value) === 'useTranslation'
  )
}

function isEmptyNamespace(sourceCode, node) {
  node = unwrap(node)
  if (!node) return true
  if (node.type === 'Literal') return node.value === null || node.value === ''
  if (node.type === 'Identifier' && node.name === 'undefined')
    return !getVariable(sourceCode, node)?.defs.length
  if (node.type === 'ArrayExpression') return node.elements.length === 0
  return false
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require an explicit, non-empty namespace in translation hooks.' },
    schema: [],
    messages: {
      emptyNamespace:
        'Declare the namespaces used by useTranslation. Use useLocale when only the current locale is needed.',
    },
  },
  create(context) {
    const importedNames = new Set(
      context.sourceCode.ast.body
        .filter(
          (node) => node.type === 'ImportDeclaration' && translationModules.has(node.source.value),
        )
        .flatMap((node) => node.specifiers.map((specifier) => specifier.local.name)),
    )
    if (!importedNames.size) return {}
    return {
      CallExpression(node) {
        const callee = unwrap(node.callee)
        const identifier = callee.type === 'MemberExpression' ? unwrap(callee.object) : callee
        if (!importedNames.has(identifier.name)) return
        if (
          isTranslationHook(context.sourceCode, node.callee) &&
          isEmptyNamespace(context.sourceCode, node.arguments[0])
        )
          context.report({ node, messageId: 'emptyNamespace' })
      },
    }
  },
}
