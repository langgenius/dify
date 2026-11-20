import type { Rule } from 'eslint'
import { dirname, resolve } from 'node:path'

const skillEntrypoints = new Set(['list/page', 'detail/route', 'permissions', 'error'])
const agentEditorEntrypoints = new Set(['workflow-panel', 'roster-panel', 'tool-provider-catalog'])
const tagEntrypoints = new Set([
  'tag-filter',
  'tag-selector',
  'tag-management-dialog',
  'tag-option',
  'tag-search-content',
])

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: { description: 'Preserve the public boundaries of migrated Web features.' },
    schema: [],
    messages: {
      entrypoint:
        'Consume {{feature}} through its documented public entrypoints; {{path}} is internal.',
      consumer: '{{feature}} must not depend on consumer UI internals: {{path}}.',
      filePresentation:
        'Skills must not depend on Agent V2. Use the shared file presentation contract when displaying files.',
    },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/')
    const owner = filename.match(/(?:^|\/)web\/features\/([^/]+)\//)?.[1]

    const check = (node: Rule.Node, source: unknown) => {
      if (typeof source !== 'string') return
      const path = (
        source.startsWith('@/')
          ? source.slice(2)
          : source.startsWith('.')
            ? resolve(dirname(filename), source).replaceAll('\\', '/').split('/web/')[1]
            : undefined
      )?.replace(/\.[cm]?[jt]sx?$/, '')
      if (!path) return

      if (
        (owner === 'marketplace' || owner === 'tag-management') &&
        path.startsWith('app/components/')
      ) {
        context.report({ node, messageId: 'consumer', data: { feature: owner, path: source } })
        return
      }
      if (owner === 'skills' && path.startsWith('features/agent-v2/')) {
        context.report({ node, messageId: 'filePresentation' })
        return
      }

      const boundaries = [
        ['skills', 'features/skills/', skillEntrypoints],
        ['agent-v2', 'features/agent-v2/agent-editor/', agentEditorEntrypoints],
        ['tag-management', 'features/tag-management/', tagEntrypoints],
      ] as const
      for (const [feature, prefix, entrypoints] of boundaries) {
        if (
          owner !== feature &&
          path.startsWith(prefix) &&
          !entrypoints.has(path.slice(prefix.length))
        ) {
          context.report({ node, messageId: 'entrypoint', data: { feature, path: source } })
          return
        }
      }
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node, node.source.value)
      },
    }
  },
}

export default rule
