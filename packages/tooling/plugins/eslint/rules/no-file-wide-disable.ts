import type { Rule } from 'eslint'
import { getDisableDirectives } from '../utils.ts'
const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require block disables to end with a matching enable.' },
    schema: [],
    messages: {
      fileWideDisable:
        'File-wide disables are forbidden. Use a matching enable, or baseline existing errors with `vp run -w lint:oxlint <path> --suppress-all`. For intentional file exclusions, configure packages/tooling/lint.config.ts with a reason.',
    },
  },
  create(context) {
    return {
      Program() {
        const pending = new Map<
          ReturnType<typeof getDisableDirectives>[number],
          Set<string> | null
        >()
        for (const directive of getDisableDirectives(context.sourceCode)) {
          const rules = directive.value
            .split(',')
            .map((rule) => rule.trim())
            .filter(Boolean)
          if (directive.type === 'disable') {
            // null represents disabling all rules, which only a bare enable can close.
            pending.set(directive, rules.length ? new Set(rules) : null)
          } else if (directive.type === 'enable') {
            for (const [disable, remaining] of pending) {
              if (
                disable.node.value.trimStart().startsWith('oxlint-') !==
                directive.node.value.trimStart().startsWith('oxlint-')
              )
                continue
              if (!rules.length) {
                pending.delete(disable)
              } else if (remaining) {
                for (const rule of rules) remaining.delete(rule)
                if (!remaining.size) pending.delete(disable)
              }
            }
          }
        }
        for (const directive of pending.keys()) {
          context.report({ node: directive.node, messageId: 'fileWideDisable' })
        }
      },
    }
  },
}

export default rule
