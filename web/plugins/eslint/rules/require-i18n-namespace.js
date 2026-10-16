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

function isNamespaceArray(node) {
  node = unwrap(node)
  return node?.type === 'ArrayExpression' && node.elements.length > 0
}

function onlyReadsI18n(node) {
  while (node.parent && unwrap(node.parent) === unwrap(node)) node = node.parent
  const parent = node.parent
  const isI18nProperty = (property, computed) =>
    property.type === 'Literal' ? property.value === 'i18n' : !computed && property.name === 'i18n'
  if (parent.type === 'MemberExpression' && parent.object === node)
    return isI18nProperty(parent.property, parent.computed)
  const pattern =
    parent.type === 'VariableDeclarator' && parent.init === node
      ? parent.id
      : parent.type === 'AssignmentExpression' && parent.right === node
        ? parent.left
        : undefined
  if (pattern?.type !== 'ObjectPattern' || pattern.properties.length !== 1) return false
  const property = pattern.properties[0]
  return property.type === 'Property' && isI18nProperty(property.key, property.computed)
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require an explicit namespace array unless only the i18n instance is read.',
    },
    schema: [],
    messages: {
      emptyNamespace: 'Declare the namespaces used by useTranslation as a non-empty inline array.',
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
          !isNamespaceArray(node.arguments[0]) &&
          !onlyReadsI18n(node)
        )
          context.report({ node, messageId: 'emptyNamespace' })
      },
    }
  },
}
