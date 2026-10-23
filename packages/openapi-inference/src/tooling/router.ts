import type { OperationDescriptor } from '../operation.js'

export type RouterNode = {
  children: Map<string, RouterNode>
  methods: Map<string, OperationDescriptor>
}

function memberName(segment: string): string {
  const param = /^\{([^}]+)\}$/.exec(segment)
  const words = (param?.[1] ?? segment)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
  if (param) words.unshift('by')
  return words
    .map((word, index) =>
      index ? word[0]!.toUpperCase() + word.slice(1) : word[0]!.toLowerCase() + word.slice(1),
    )
    .join('')
}

export function createRouter(operations: Map<string, OperationDescriptor>): RouterNode {
  const root: RouterNode = { children: new Map(), methods: new Map() }
  for (const operation of operations.values()) {
    let node = root
    const segments = operation.path.split(/[/:]/).filter(Boolean)
    for (const segment of segments.length ? segments : ['root']) {
      if (!node.children.has(segment))
        node.children.set(segment, { children: new Map(), methods: new Map() })
      node = node.children.get(segment)!
    }
    if (node.methods.has(operation.method))
      throw new Error(`Routes normalize to the same client member: ${operation.path}`)
    node.methods.set(operation.method, operation)
  }
  function normalize(node: RouterNode): RouterNode {
    const children = new Map<string, RouterNode>()
    // Literal camelCase wins, then kebab-case precedes legacy underscore aliases.
    const ordered = [...node.children].sort(
      ([a], [b]) =>
        Number(b === memberName(b)) - Number(a === memberName(a)) || (a < b ? -1 : a > b ? 1 : 0),
    )
    for (const [raw, child] of ordered) {
      let key = memberName(raw)
      if (children.has(key)) key = raw
      if (!key || children.has(key) || node.methods.has(key))
        throw new Error(`Route namespace collides with an existing member: ${raw}`)
      if (key === 'key')
        throw new Error('Route segment "key" conflicts with the query key() helper')
      children.set(key, normalize(child))
    }
    return { children, methods: node.methods }
  }
  return normalize(root)
}

export const routerQuery = '?openapi-router='
export const queryQuery = '?openapi-query='

export function routerModuleId(fileName: string, path: string[], query = false): string {
  const marker = query ? queryQuery : routerQuery
  return `${fileName}${fileName.includes('?') ? marker.replace('?', '&') : marker}${encodeURIComponent(JSON.stringify(path))}`
}

/** Every namespace is a separate ESM module, enabling static property tree-shaking. */
export function routerModule(
  root: RouterNode,
  fileName: string,
  path: string[],
  query = false,
  runtimeModule?: string,
): string {
  let node = root
  for (const key of path) {
    const child = node.children.get(key)
    if (!child) throw new Error(`Unknown virtual router path: ${path.join('.')}`)
    node = child
  }
  let text = 'import { invokeRpcOperation } from "@dify/openapi-inference/runtime";\n'
  if (runtimeModule) text += `import runtime from ${JSON.stringify(runtimeModule)};\n`
  const runtime = runtimeModule ? ', runtime' : ''
  if (query) {
    text +=
      'import { createQueryOperation, createQueryKey } from "@dify/openapi-inference/query-runtime";\n'
    text += `export const key = /* @__PURE__ */ createQueryKey(${JSON.stringify(path)}${runtime});\n`
  }
  let index = 0
  for (const [method, op] of node.methods) {
    const binding = `operation${index++}`
    const callable = `(input, options) => invokeRpcOperation(${JSON.stringify(op)}, input, options${runtime})`
    text += `const ${binding} = ${
      query
        ? `/* @__PURE__ */ createQueryOperation(${JSON.stringify(op)}, ${JSON.stringify([...path, method])}${runtime})`
        : callable
    };\nexport { ${binding} as ${JSON.stringify(method)} };\n`
  }
  for (const key of node.children.keys()) {
    const id = routerModuleId(fileName, [...path, key], query)
    text += `export * as ${JSON.stringify(key)} from ${JSON.stringify(id)};\n`
  }
  return text
}
