import type { Rule, Scope } from 'eslint'

type Node = Rule.Node
type BindingKind = 'store' | 'reactFlow' | 'state'

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

function getStateTarget(node: Node | null | undefined) {
  if (
    node?.type !== 'CallExpression' ||
    node.callee.type !== 'MemberExpression' ||
    node.callee.computed ||
    node.callee.property.type !== 'Identifier' ||
    node.callee.property.name !== 'getState'
  )
    return undefined
  return node.callee.object as Node
}

function propertyName(node: Node) {
  if (node.type !== 'Property' || node.computed) return undefined
  if (node.key.type === 'Identifier') return node.key.name
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value
  return undefined
}

const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
])

function objectsIn(expression: Node | null | undefined): Node[] {
  if (!expression) return []
  if (expression.type === 'ObjectExpression') return [expression]
  if (expression.type === 'ConditionalExpression')
    return [...objectsIn(expression.consequent as Node), ...objectsIn(expression.alternate as Node)]
  if (expression.type === 'LogicalExpression')
    return [...objectsIn(expression.left as Node), ...objectsIn(expression.right as Node)]
  return []
}

function returnStatementsIn(node: Node): Node[] {
  if (node.type === 'ReturnStatement') return [node]
  const returns: Node[] = []
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue
    for (const child of Array.isArray(value) ? value : [value]) {
      if (!child || typeof child !== 'object' || typeof child.type !== 'string') continue
      if (FUNCTION_TYPES.has(child.type)) continue
      returns.push(...returnStatementsIn(child as Node))
    }
  }
  return returns
}

function returnedObjects(fn: Node): Node[] {
  if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return []
  const body = fn.body as Node
  if (body.type !== 'BlockStatement') return objectsIn(body)
  return returnStatementsIn(body).flatMap((statement) =>
    statement.type === 'ReturnStatement' ? objectsIn(statement.argument as Node) : [],
  )
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
    const { sourceCode } = context

    const findVariable = (identifier: Node & { name: string }) => {
      for (
        let scope: Scope.Scope | null = sourceCode.getScope(identifier);
        scope;
        scope = scope.upper
      ) {
        const variable = scope.set.get(identifier.name)
        if (variable) return variable
      }
      return undefined
    }

    const bindingKind = (node: Node): BindingKind | undefined => {
      if (node.type !== 'Identifier') return undefined
      const definition = findVariable(node)?.defs[0]
      if (definition?.type !== 'Variable') return undefined
      const declarator = definition.node as Node
      if (declarator.type !== 'VariableDeclarator' || declarator.id.type !== 'Identifier')
        return undefined
      const init = declarator.init as Node | null | undefined
      if (isCallTo(init, 'useStoreApi')) return 'store'
      if (isCallTo(init, 'useReactFlow')) return 'reactFlow'
      const stateTarget = getStateTarget(init)
      if (
        stateTarget &&
        (isCallTo(stateTarget, 'useStoreApi') || bindingKind(stateTarget) === 'store')
      )
        return 'state'
      return undefined
    }

    const isStore = (node: Node) => isCallTo(node, 'useStoreApi') || bindingKind(node) === 'store'

    const isRawGetState = (node: Node) => {
      const stateTarget = getStateTarget(node)
      return !!stateTarget && isStore(stateTarget)
    }

    const settersFor = (node: Node) => {
      if (isRawGetState(node)) return STORE_SETTERS
      if (isCallTo(node, 'useReactFlow')) return REACT_FLOW_SETTERS
      const kind = bindingKind(node)
      if (kind === 'state') return STORE_SETTERS
      if (kind === 'reactFlow') return REACT_FLOW_SETTERS
      return undefined
    }

    const report = (node: Node, setter: string) =>
      context.report({ node, messageId: 'rawGraphWrite', data: { setter } })

    return {
      VariableDeclarator(node: Node) {
        if (node.type !== 'VariableDeclarator' || node.id.type !== 'ObjectPattern' || !node.init)
          return
        const setters = settersFor(node.init as Node)
        if (!setters) return
        for (const property of node.id.properties) {
          const name = propertyName(property as Node)
          if (name && setters.has(name)) report(property as Node, name)
        }
      },
      MemberExpression(node: Node) {
        if (node.type !== 'MemberExpression' || node.computed) return
        if (node.property.type !== 'Identifier') return
        const name = node.property.name
        if (!REACT_FLOW_SETTERS.has(name)) return
        if (settersFor(node.object as Node)?.has(name)) report(node, name)
      },
      CallExpression(node: Node) {
        if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') return
        const { callee } = node
        if (callee.computed || callee.property.type !== 'Identifier') return
        if (callee.property.name !== 'setState') return
        if (!isStore(callee.object as Node)) return
        const [argument] = node.arguments as Node[]
        if (!argument) return
        const objects =
          argument.type === 'ObjectExpression' ? [argument] : returnedObjects(argument)
        for (const object of objects) {
          if (object.type !== 'ObjectExpression') continue
          for (const property of object.properties) {
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
