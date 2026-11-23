import type { Rule } from 'eslint'

type Node = Rule.Node

const FUNCTION_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'StaticBlock',
  'PropertyDefinition',
])

function isInsideFunction(node: Node) {
  for (let current = node.parent; current; current = current.parent) {
    if (FUNCTION_TYPES.has(current.type)) return true
  }
  return false
}

function clockCallName(node: Node): string | undefined {
  if (node.type === 'NewExpression') {
    if (node.callee.type === 'Identifier' && node.callee.name === 'Date' && !node.arguments.length)
      return 'new Date()'
    return undefined
  }
  if (node.type !== 'CallExpression') return undefined
  const { callee } = node
  if (callee.type === 'Identifier' && callee.name === 'dayjs' && !node.arguments.length)
    return 'dayjs()'
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Date' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'now'
  )
    return 'Date.now()'
  return undefined
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow reading the current time at module scope.',
    },
    schema: [],
    messages: {
      moduleScopeClock:
        '{{call}} at module scope is evaluated once: it goes stale in a long-lived tab or server, and Cloudflare Workers return 1970 there. Read the clock inside the function, render, or handler that needs it.',
    },
  },
  create(context) {
    const check = (node: Node) => {
      const call = clockCallName(node)
      if (call && !isInsideFunction(node))
        context.report({ node, messageId: 'moduleScopeClock', data: { call } })
    }
    return {
      NewExpression: check,
      CallExpression: check,
    }
  },
}

export default rule
