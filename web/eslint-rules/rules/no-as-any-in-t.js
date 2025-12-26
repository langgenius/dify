/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow using "as any" type assertion in t() function calls',
    },
    schema: [],
    messages: {
      noAsAnyInT:
        'Avoid using "as any" in t() function calls. Use proper i18n key types instead.',
    },
  },
  create(context) {
    /**
     * Check if this is a t() function call
     * @param {import('estree').CallExpression} node
     * @returns {boolean}
     */
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

    return {
      CallExpression(node) {
        if (!isTCall(node) || node.arguments.length === 0)
          return

        const firstArg = node.arguments[0]

        // Check if the first argument uses "as any"
        if (isAsAny(firstArg)) {
          context.report({
            node: firstArg,
            messageId: 'noAsAnyInT',
          })
        }
      },
    }
  },
}
