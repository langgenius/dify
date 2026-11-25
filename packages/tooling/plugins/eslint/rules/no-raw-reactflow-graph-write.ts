import type { Rule } from 'eslint'

type Node = Rule.Node

const GRAPH_SETTERS = new Set(['setNodes', 'setEdges'])

function isGetStateCallOn(node: Node | null | undefined, storeNames: Set<string>) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'getState' &&
    node.callee.object.type === 'Identifier' &&
    storeNames.has(node.callee.object.name)
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
        'Disallow writing the workflow graph through the raw React Flow store, which bypasses the collaboration CRDT.',
    },
    schema: [],
    messages: {
      rawGraphWrite:
        "React Flow's {{setter}} skips the collaboration CRDT, so collaborators never see the change and the next snapshot overwrites it. Use useCollaborativeWorkflow().{{setter}}(next); pass false as the second argument only for local-only UI state such as run status, hover, or selection.",
    },
  },
  create(context) {
    const storeNames = new Set<string>()
    const stateNames = new Set<string>()
    const destructures: Array<{ node: Node; init: Node }> = []
    const stateMembers: Array<{ node: Node; object: Node }> = []

    return {
      VariableDeclarator(node: Node) {
        if (node.type !== 'VariableDeclarator' || !node.init) return
        const init = node.init as Node
        if (
          node.id.type === 'Identifier' &&
          init.type === 'CallExpression' &&
          init.callee.type === 'Identifier' &&
          init.callee.name === 'useStoreApi'
        ) {
          storeNames.add(node.id.name)
          return
        }
        if (node.id.type === 'Identifier' && init.type === 'CallExpression') {
          destructures.push({ node: node.id as Node, init })
          return
        }
        if (node.id.type === 'ObjectPattern') destructures.push({ node: node.id as Node, init })
      },
      MemberExpression(node: Node) {
        if (node.type !== 'MemberExpression' || node.computed) return
        if (node.property.type !== 'Identifier' || !GRAPH_SETTERS.has(node.property.name)) return
        stateMembers.push({ node, object: node.object as Node })
      },
      'Program:exit': () => {
        for (const { node, init } of destructures) {
          if (!isGetStateCallOn(init, storeNames)) continue
          if (node.type === 'Identifier') {
            stateNames.add(node.name)
            continue
          }
          if (node.type !== 'ObjectPattern') continue
          for (const property of node.properties) {
            const name = propertyName(property as Node)
            if (name && GRAPH_SETTERS.has(name))
              context.report({
                node: property as Node,
                messageId: 'rawGraphWrite',
                data: { setter: name },
              })
          }
        }
        for (const { node, object } of stateMembers) {
          const isRawState =
            isGetStateCallOn(object, storeNames) ||
            (object.type === 'Identifier' && stateNames.has(object.name))
          if (!isRawState || node.type !== 'MemberExpression') continue
          if (node.property.type !== 'Identifier') continue
          context.report({
            node,
            messageId: 'rawGraphWrite',
            data: { setter: node.property.name },
          })
        }
      },
    }
  },
}

export default rule
