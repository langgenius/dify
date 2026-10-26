import type { Rule } from 'eslint'
import { getDisableDirectives } from '../utils.ts'
const rule: Rule.RuleModule = {
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
        for (const directive of getDisableDirectives(context.sourceCode)) {
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

export default rule
