import type { Rule } from 'eslint'

type Node = Rule.Node

const STORE_SETTERS = new Set(['setNodes', 'setEdges'])
const REACT_FLOW_SETTERS = new Set([
  'setNodes',
  'setEdges',
  'addNodes',
  'addEdges',
  'deleteElements',
])
const GRAPH_STATE_KEYS = new Set(['nodes', 'edges'])

function isCallTo(node: Node | null | undefined, name: string) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === name
  )
}

function isMethodCallOn(node: Node | null | undefined, method: string, objectNames: Set<string>) {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === method &&
    node.callee.object.type === 'Identifier' &&
    objectNames.has(node.callee.object.name)
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
        "React Flow's {{setter}} skips the collaboration CRDT, so collaborators never see the change and the next snapshot overwrites it. Write the graph through useCollaborativeWorkflow().setNodes/setEdges; pass false as the second argument only for local-only UI state such as run status, hover, or selection.",
    },
  },
  create(context) {
    const storeNames = new Set<string>()
    const reactFlowNames = new Set<string>()
    const stateNames = new Set<string>()
    const destructures: Array<{ pattern: Node; init: Node }> = []
    const stateCandidates: Array<{ name: string; init: Node }> = []
    const members: Array<{ node: Node; object: Node; name: string }> = []
    const calls: Node[] = []

    const isRawState = (node: Node) =>
      isMethodCallOn(node, 'getState', storeNames) ||
      (node.type === 'Identifier' && stateNames.has(node.name))
    const isReactFlow = (node: Node) =>
      isCallTo(node, 'useReactFlow') ||
      (node.type === 'Identifier' && reactFlowNames.has(node.name))
    const settersFor = (node: Node) => {
      if (isRawState(node)) return STORE_SETTERS
      if (isReactFlow(node)) return REACT_FLOW_SETTERS
      return undefined
    }
    const report = (node: Node, setter: string) =>
      context.report({ node, messageId: 'rawGraphWrite', data: { setter } })

    return {
      VariableDeclarator(node: Node) {
        if (node.type !== 'VariableDeclarator' || !node.init) return
        const init = node.init as Node
        if (node.id.type === 'ObjectPattern') {
          destructures.push({ pattern: node.id as Node, init })
          return
        }
        if (node.id.type !== 'Identifier') return
        if (isCallTo(init, 'useStoreApi')) storeNames.add(node.id.name)
        else if (isCallTo(init, 'useReactFlow')) reactFlowNames.add(node.id.name)
        else stateCandidates.push({ name: node.id.name, init })
      },
      MemberExpression(node: Node) {
        if (node.type !== 'MemberExpression' || node.computed) return
        if (node.property.type !== 'Identifier') return
        if (!REACT_FLOW_SETTERS.has(node.property.name)) return
        members.push({ node, object: node.object as Node, name: node.property.name })
      },
      CallExpression(node: Node) {
        calls.push(node)
      },
      'Program:exit': () => {
        for (const { name, init } of stateCandidates)
          if (isMethodCallOn(init, 'getState', storeNames)) stateNames.add(name)

        for (const { pattern, init } of destructures) {
          const setters = settersFor(init)
          if (!setters || pattern.type !== 'ObjectPattern') continue
          for (const property of pattern.properties) {
            const name = propertyName(property as Node)
            if (name && setters.has(name)) report(property as Node, name)
          }
        }

        for (const { node, object, name } of members) {
          if (settersFor(object)?.has(name)) report(node, name)
        }

        for (const call of calls) {
          if (call.type !== 'CallExpression') continue
          if (!isMethodCallOn(call, 'setState', storeNames)) continue
          const [argument] = call.arguments
          if (argument?.type !== 'ObjectExpression') continue
          for (const property of argument.properties) {
            const name = propertyName(property as Node)
            if (name && GRAPH_STATE_KEYS.has(name))
              report(property as Node, `setState({ ${name} })`)
          }
        }
      },
    }
  },
}

export default rule
