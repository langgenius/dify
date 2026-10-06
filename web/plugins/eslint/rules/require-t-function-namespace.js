function getVariable(sourceCode, node) {
  let scope = sourceCode.getScope(node)
  while (scope) {
    const variable = scope.set.get(node.name)
    if (variable) return variable
    scope = scope.upper
  }
}

function isTFunction(sourceCode, name) {
  const qualified = name.type === 'TSQualifiedName'
  if (qualified && name.right.name !== 'TFunction') return false
  const identifier = qualified ? name.left : name
  if (identifier.type !== 'Identifier') return false
  const definition = getVariable(sourceCode, identifier)?.defs[0]
  if (definition?.type !== 'ImportBinding' || definition.parent.source.value !== 'i18next')
    return false
  if (qualified) return definition.node.type === 'ImportNamespaceSpecifier'
  return (
    definition.node.type === 'ImportSpecifier' &&
    (definition.node.imported.name ?? definition.node.imported.value) === 'TFunction'
  )
}

function isNamespaceTuple(node) {
  if (node?.type === 'TSTypeOperator' && node.operator === 'readonly') node = node.typeAnnotation
  return (
    node?.type === 'TSTupleType' &&
    node.elementTypes.length > 0 &&
    node.elementTypes.every(
      (element) =>
        element.type === 'TSLiteralType' &&
        typeof element.literal.value === 'string' &&
        element.literal.value.length > 0,
    )
  )
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: { description: 'Require explicit namespace tuples for i18next TFunction types.' },
    schema: [],
    messages: {
      namespaceTuple:
        "Declare TFunction namespaces as a non-empty tuple of string literals, e.g. TFunction<['common', 'workflow']>.",
    },
  },
  create(context) {
    const importedNames = new Set(
      context.sourceCode.ast.body
        .filter((node) => node.type === 'ImportDeclaration' && node.source.value === 'i18next')
        .flatMap((node) => node.specifiers.map((specifier) => specifier.local.name)),
    )
    const check = (node) => {
      if (!isNamespaceTuple(node.typeArguments?.params[0]))
        context.report({ node, messageId: 'namespaceTuple' })
    }
    return {
      TSTypeReference(node) {
        const identifier =
          node.typeName.type === 'TSQualifiedName' ? node.typeName.left : node.typeName
        if (importedNames.has(identifier.name) && isTFunction(context.sourceCode, node.typeName))
          check(node)
      },
      TSImportType(node) {
        if (
          node.source.value === 'i18next' &&
          node.qualifier?.type === 'Identifier' &&
          node.qualifier.name === 'TFunction'
        )
          check(node)
      },
    }
  },
}
