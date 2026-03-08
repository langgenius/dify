/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require ns option in t() function calls',
    },
    schema: [],
    messages: {
      missingNsOption:
        'Translation call is missing { ns: \'xxx\' } option. Add a second argument with ns property.',
    },
  },
  create(context) {
    function hasNsOption(node) {
      if (node.arguments.length < 2)
        return false
      const secondArg = node.arguments[1]
      if (secondArg.type !== 'ObjectExpression')
        return false
      return secondArg.properties.some(
        prop => prop.type === 'Property'
          && prop.key.type === 'Identifier'
          && prop.key.name === 'ns',
      )
    }

    return {
      CallExpression(node) {
        // Check for t() calls - both direct t() and i18n.t()
        const isTCall = (
          node.callee.type === 'Identifier'
          && node.callee.name === 't'
        ) || (
          node.callee.type === 'MemberExpression'
          && node.callee.property.type === 'Identifier'
          && node.callee.property.name === 't'
        )

        if (isTCall && node.arguments.length > 0) {
          if (!hasNsOption(node)) {
            context.report({
              node,
              messageId: 'missingNsOption',
            })
          }
        }
      },
    }
  },
}
