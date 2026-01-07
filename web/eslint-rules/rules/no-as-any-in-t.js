/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow using type assertions in t() function calls',
    },
    schema: [
      {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['any', 'all'],
            default: 'any',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noAsAnyInT:
        'Avoid using "as any" in t() function calls. Use proper i18n key types instead.',
      noAsInT:
        'Avoid using type assertions in t() function calls. Use proper i18n key types instead.',
    },
  },
  create(context) {
    const options = context.options[0] || {}
    const mode = options.mode || 'any'

    function isTCall(node) {
      // Direct t() call
      if (node.callee.type === 'Identifier' && node.callee.name === 't')
        return true
      // i18n.t() or similar member expression
      if (
        node.callee.type === 'MemberExpression'
        && node.callee.property.type === 'Identifier'
        && node.callee.property.name === 't'
      ) {
        return true
      }
      return false
    }

    /**
     * Check if a node is a TSAsExpression with "any" type
     * @param {object} node
     * @returns {boolean}
     */
    function isAsAny(node) {
      return (
        node.type === 'TSAsExpression'
        && node.typeAnnotation
        && node.typeAnnotation.type === 'TSAnyKeyword'
      )
    }

    /**
     * Check if a node is a TSAsExpression (excluding "as const")
     * @param {object} node
     * @returns {boolean}
     */
    function isAsExpression(node) {
      if (node.type !== 'TSAsExpression')
        return false
      // Ignore "as const"
      if (node.typeAnnotation && node.typeAnnotation.type === 'TSTypeReference') {
        const typeName = node.typeAnnotation.typeName
        if (typeName && typeName.type === 'Identifier' && typeName.name === 'const')
          return false
      }
      return true
    }

    return {
      CallExpression(node) {
        if (!isTCall(node) || node.arguments.length === 0)
          return

        const firstArg = node.arguments[0]

        if (mode === 'all') {
          // Check for any type assertion
          if (isAsExpression(firstArg)) {
            context.report({
              node: firstArg,
              messageId: 'noAsInT',
            })
          }
        }
        else {
          // Check only for "as any"
          if (isAsAny(firstArg)) {
            context.report({
              node: firstArg,
              messageId: 'noAsAnyInT',
            })
          }
        }
      },
    }
  },
}
