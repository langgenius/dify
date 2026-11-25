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

function variableOf(
  identifier: Node,
  scope: ReturnType<Rule.RuleContext['sourceCode']['getScope']>,
) {
  if (identifier.type !== 'Identifier') return undefined
  for (let current: typeof scope | null = scope; current; current = current.upper) {
    const variable = current.set.get(identifier.name)
    if (variable) return variable
  }
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
    // Track bindings, not names: an unrelated `options` elsewhere is not a policy.
    const mutationOptionVariables = new Set<unknown>()
    const isMutationOptions = (node: Node) =>
      isMutationOptionsCall(node) ||
      mutationOptionVariables.has(variableOf(node, context.sourceCode.getScope(node)))
    return {
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !isMutationOptionsCall(node.init as Node)) return
        const variable = variableOf(node.id as Node, context.sourceCode.getScope(node))
        if (variable) mutationOptionVariables.add(variable)
      },
      MemberExpression(node) {
        if (
          !node.computed &&
          node.property.type === 'Identifier' &&
          CALLBACKS.has(node.property.name) &&
          isMutationOptions(node.object as Node)
        )
          context.report({ node, messageId: 'manualPolicyCall' })
      },
      'ObjectExpression:exit': function (node: Node) {
        if (node.type !== 'ObjectExpression') return
        let spread = false
        for (const property of node.properties as Node[]) {
          if (property.type === 'SpreadElement') {
            const argument = property.argument as Node
            if (isMutationOptions(argument)) spread = true
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
