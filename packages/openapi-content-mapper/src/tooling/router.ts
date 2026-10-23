import type { OperationDescriptor } from '../operation.js'
import type { operationConfig } from './operation-config.js'

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
    if (operation.clientPath) continue
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
  const normalized = normalize(root)
  for (const operation of operations.values()) {
    if (!operation.clientPath) continue
    let node = normalized
    for (const member of operation.clientPath.slice(0, -1)) {
      if (node.methods.has(member))
        throw new Error(`Client path collides with an operation: ${operation.clientPath.join('.')}`)
      if (!node.children.has(member))
        node.children.set(member, { children: new Map(), methods: new Map() })
      node = node.children.get(member)!
    }
    const member = operation.clientPath.at(-1)!
    if (node.children.has(member) || node.methods.has(member))
      throw new Error(`Duplicate client path: ${operation.clientPath.join('.')}`)
    node.methods.set(member, operation)
  }
  return normalized
}

export const routerQuery = '?openapi-router='
export const queryQuery = '?openapi-query='
export const errorsQuery = '?openapi-errors='

export function moduleQuery(id: string) {
  return id.includes(errorsQuery) ? errorsQuery : id.includes(queryQuery) ? queryQuery : routerQuery
}

export function routerModuleId(
  fileName: string,
  path: string[],
  query: boolean | 'errors' = false,
): string {
  const marker = query === 'errors' ? errorsQuery : query ? queryQuery : routerQuery
  return `${fileName}${fileName.includes('?') ? marker.replace('?', '&') : marker}${encodeURIComponent(JSON.stringify(path))}`
}

/** Every namespace is a separate ESM module, enabling static property tree-shaking. */
export function routerModule(
  root: RouterNode,
  fileName: string,
  path: string[],
  query: boolean | 'errors' = false,
  runtimeModule?: string,
  configs?: {
    queries: ReturnType<typeof operationConfig>
    errors: ReturnType<typeof operationConfig>
  },
  resolveModule: (file: string) => string = (file) => file,
): string {
  let node = root
  for (const key of query === 'errors' ? path.slice(0, -1) : path) {
    const child = node.children.get(key)
    if (!child) throw new Error(`Unknown virtual router path: ${path.join('.')}`)
    node = child
  }
  if (query === 'errors') {
    const method = path.at(-1)!
    const operation = node.methods.get(method)
    if (!operation || !configs?.errors.file) throw new Error('Unknown operation error module')
    const key = `${operation.method.toUpperCase()} ${operation.path}`
    return `export { ${JSON.stringify(key)} as errors } from ${JSON.stringify(resolveModule(configs.errors.file))};\n`
  }
  let text = query
    ? 'import { createQueryOperation, createQueryKey } from "@dify/openapi-content-mapper/query-runtime";\n'
    : 'import { invokeRpcOperation } from "@dify/openapi-content-mapper/runtime";\n'
  if (runtimeModule) text += `import runtime from ${JSON.stringify(runtimeModule)};\n`
  const runtime = runtimeModule ? ', runtime' : ''
  if (query)
    text += `export const key = /* @__PURE__ */ createQueryKey(${JSON.stringify(path)}${runtime});\n`
  let index = 0
  for (const [method, op] of node.methods) {
    const binding = `operation${index++}`
    const key = `${op.method.toUpperCase()} ${op.path}`
    const errors = configs?.errors
    const queries = configs?.queries
    let errorHandler = 'undefined'
    let defaults = 'undefined'
    if (errors?.file && errors.names.has(key)) {
      text += `import { createErrorHandler as ${binding}Handler } from "@dify/openapi-content-mapper/errors";\n`
      errorHandler = `${binding}ErrorHandler`
      text += `const ${errorHandler} = /* @__PURE__ */ ${binding}Handler(async () => { const { errors } = await import(${JSON.stringify(routerModuleId(fileName, [...path, method], 'errors'))}); return errors; });\n`
    }
    if (query && queries?.file && queries.names.has(key)) {
      defaults = `${binding}Defaults`
      text += `import { ${JSON.stringify(key)} as ${defaults} } from ${JSON.stringify(resolveModule(queries.file))};\n`
    }
    const { clientPath: _clientPath, ...descriptor } = op
    const configured = `${runtimeModule ? 'runtime' : 'undefined'}`
    text += `const ${binding} = ${
      query
        ? `/* @__PURE__ */ createQueryOperation(${JSON.stringify(descriptor)}, ${JSON.stringify([...path, method])}, ${configured}, ${defaults}, ${errorHandler})`
        : `(input, options) => invokeRpcOperation(${JSON.stringify(descriptor)}, input, options, ${configured}, ${errorHandler})`
    };\nexport { ${binding} as ${JSON.stringify(method)} };\n`
  }
  for (const key of node.children.keys()) {
    const id = routerModuleId(fileName, [...path, key], query)
    text += `export * as ${JSON.stringify(key)} from ${JSON.stringify(id)};\n`
  }
  return text
}
