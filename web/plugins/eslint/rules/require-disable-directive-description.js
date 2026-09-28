export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require a reason for disabling a lint rule.',
    },
    schema: [],
    messages: {
      missingDescription: 'Explain why this disable is necessary after `--`.',
    },
  },
  create(context) {
    return {
      Program() {
        for (const directive of context.sourceCode.getDisableDirectives().directives) {
          if (directive.type !== 'enable' && !directive.justification.trim()) {
            context.report({
              node: directive.node,
              messageId: 'missingDescription',
            })
          }
        }
      },
    }
  },
}
