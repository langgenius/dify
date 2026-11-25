import type { Rule } from 'eslint'

type Node = Rule.Node

const CALLBACKS = new Set(['onMutate', 'onSuccess', 'onError', 'onSettled'])

function isMutationOptionsCall(node: Node | null | undefined) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'mutationOptions'
  )
}

function propertyName(node: Node) {
  if (node.type !== 'Property' || node.computed) return undefined
  if (node.key.type === 'Identifier') return node.key.name
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value
  return undefined
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Pass mutation callbacks to `mutationOptions()` so the shared cache policy runs with them.',
    },
    schema: [],
    messages: {
      spreadOverride:
        'Spreading `mutationOptions()` and then setting `{{name}}` replaces the shared cache policy. Pass `{{name}}` to `mutationOptions({ {{name}} })` instead; the policy runs first.',
      manualPolicyCall:
        'Do not call a mutation policy callback by hand. Pass your callback to `mutationOptions()`, which runs the policy before it.',
    },
  },
  create(context) {
    const mutationOptionNames = new Set<string>()
    return {
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && isMutationOptionsCall(node.init as Node))
          mutationOptionNames.add(node.id.name)
      },
      MemberExpression(node) {
        if (
          !node.computed &&
          node.property.type === 'Identifier' &&
          CALLBACKS.has(node.property.name) &&
          (isMutationOptionsCall(node.object as Node) ||
            (node.object.type === 'Identifier' && mutationOptionNames.has(node.object.name)))
        )
          context.report({ node, messageId: 'manualPolicyCall' })
      },
      'ObjectExpression:exit': function (node: Node) {
        if (node.type !== 'ObjectExpression') return
        let spread = false
        for (const property of node.properties as Node[]) {
          if (property.type === 'SpreadElement') {
            const argument = property.argument as Node
            if (
              isMutationOptionsCall(argument) ||
              (argument.type === 'Identifier' && mutationOptionNames.has(argument.name))
            )
              spread = true
            continue
          }
          const name = propertyName(property)
          if (spread && name && CALLBACKS.has(name))
            context.report({ node: property, messageId: 'spreadOverride', data: { name } })
        }
      },
    }
  },
}

export default rule
