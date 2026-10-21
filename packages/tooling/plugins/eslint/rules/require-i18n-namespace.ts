import type { TSESLint, TSESTree } from '@typescript-eslint/utils'
import type { Rule } from 'eslint'
const translationModules = new Set(['react-i18next', '#i18n'])

function unwrap(node: TSESTree.Node | undefined) {
  while (
    node &&
    [
      'TSAsExpression',
      'TSSatisfiesExpression',
      'TSNonNullExpression',
      'TSTypeAssertion',
      'ParenthesizedExpression',
      'ChainExpression',
    ].includes(node.type) &&
    'expression' in node &&
    typeof node.expression !== 'boolean'
  )
    node = node.expression
  return node
}

function getVariable(sourceCode: TSESLint.SourceCode, node: TSESTree.Identifier) {
  let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(node)
  while (scope) {
    const variable = scope.set.get(node.name)
    if (variable) return variable
    scope = scope.upper
  }
}

function isTranslationHook(sourceCode: TSESLint.SourceCode, callee: TSESTree.Node) {
  callee = unwrap(callee)!
  let identifier = callee
  let namespaceImport = false
  if (callee.type === 'MemberExpression') {
    const property =
      callee.property.type === 'Literal'
        ? callee.property.value
        : callee.property.type === 'Identifier' && !callee.computed
          ? callee.property.name
          : undefined
    if (property !== 'useTranslation') return false
    identifier = unwrap(callee.object)!
    namespaceImport = true
  }
  if (identifier.type !== 'Identifier') return false
  const definition = getVariable(sourceCode, identifier)?.defs[0]
  if (
    definition?.type !== 'ImportBinding' ||
    definition.parent.type !== 'ImportDeclaration' ||
    !translationModules.has(definition.parent.source.value)
  )
    return false
  if (namespaceImport) return definition.node.type === 'ImportNamespaceSpecifier'
  return (
    definition.node.type === 'ImportSpecifier' &&
    (definition.node.imported.type === 'Identifier'
      ? definition.node.imported.name
      : definition.node.imported.value) === 'useTranslation'
  )
}

function isNamespaceArray(node: TSESTree.Node | undefined) {
  node = unwrap(node)
  return node?.type === 'ArrayExpression' && node.elements.length > 0
}

function onlyReadsI18n(node: TSESTree.Node) {
  while (node.parent && unwrap(node.parent) === unwrap(node)) node = node.parent
  const parent = node.parent
  if (!parent) return false
  const isI18nProperty = (property: TSESTree.Node, computed: boolean) =>
    property.type === 'Literal'
      ? property.value === 'i18n'
      : !computed && property.type === 'Identifier' && property.name === 'i18n'
  if (parent.type === 'MemberExpression' && parent.object === node)
    return isI18nProperty(parent.property, parent.computed)
  const pattern =
    parent.type === 'VariableDeclarator' && parent.init === node
      ? parent.id
      : parent.type === 'AssignmentExpression' && parent.right === node
        ? parent.left
        : undefined
  if (pattern?.type !== 'ObjectPattern' || pattern.properties.length !== 1) return false
  const property = pattern.properties[0]!
  return property.type === 'Property' && isI18nProperty(property.key, property.computed)
}

const rule: TSESLint.RuleModule<string, []> = {
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
  defaultOptions: [],
  create(context) {
    const importedNames = new Set(
      context.sourceCode.ast.body
        .filter(
          (node): node is TSESTree.ImportDeclaration =>
            node.type === 'ImportDeclaration' && translationModules.has(node.source.value),
        )
        .flatMap((node) => node.specifiers.map((specifier) => specifier.local.name)),
    )
    if (!importedNames.size) return {}
    return {
      CallExpression(node) {
        const callee = unwrap(node.callee)!
        const identifier = callee.type === 'MemberExpression' ? unwrap(callee.object) : callee
        if (identifier?.type !== 'Identifier' || !importedNames.has(identifier.name)) return
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

// ESLint and Oxlint supply the parser-specific AST used by these typed listeners.
export default rule as unknown as Rule.RuleModule
