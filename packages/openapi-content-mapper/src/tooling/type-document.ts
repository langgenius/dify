import { pointer, pointerPath, record } from '../document.js'

export type Selection = { all?: boolean; children: Map<string, Selection> }
type Kind =
  | 'paths'
  | 'path'
  | 'operation'
  | 'parameters'
  | 'parameter'
  | 'body'
  | 'responses'
  | 'response'
  | 'content'
  | 'media'
  | 'schema'
  | 'schemas'

/** Keep structural references and inline schemas; referenced schemas have type aliases. */
export function typeDocument(root: unknown): Selection {
  const selection: Selection = { children: new Map() }
  const visited = new Set<string>()
  // These are the structural and schema fields read by types.ts. Literal data
  // (const, enum, required) stays whole, including keys that look like metadata.
  const fields: Partial<Record<Kind, Record<string, Kind | true>>> = {
    path: {
      parameters: 'parameters',
      get: 'operation',
      post: 'operation',
      put: 'operation',
      patch: 'operation',
      delete: 'operation',
      head: 'operation',
      options: 'operation',
      trace: 'operation',
    },
    operation: { parameters: 'parameters', requestBody: 'body', responses: 'responses' },
    parameter: { name: true, in: true, required: true, schema: 'schema' },
    body: { required: true, content: 'content' },
    response: { content: 'content' },
    media: { schema: 'schema' },
    schema: {
      $ref: true,
      const: true,
      enum: true,
      type: true,
      format: true,
      nullable: true,
      required: true,
      properties: 'schemas',
      additionalProperties: 'schema',
      items: 'schema',
      allOf: 'schemas',
      anyOf: 'schemas',
      oneOf: 'schemas',
    },
  }
  const items: Partial<Record<Kind, Kind>> = {
    paths: 'path',
    parameters: 'parameter',
    responses: 'response',
    content: 'media',
    schemas: 'schema',
  }
  function select(path: string[], value: unknown, kind: Kind | true) {
    let node = selection
    for (const key of path) {
      let child = node.children.get(key)
      if (!child) {
        child = { children: new Map() }
        node.children.set(key, child)
      }
      node = child
    }
    if (kind === true) {
      node.all = true
      return
    }
    const identity = JSON.stringify([path, kind])
    if (visited.has(identity)) return
    visited.add(identity)
    const object = record(value)
    // Resolve only the structural objects that types.ts resolves. Schema refs
    // use SchemaDocument's alias map instead of needing a second raw copy.
    if (fields[kind] && kind !== 'media' && kind !== 'schema' && typeof object.$ref === 'string') {
      select([...path, '$ref'], object.$ref, true)
      select(pointerPath(object.$ref), pointer(root, object.$ref), kind)
      return
    }
    const item = items[kind]
    if (item) {
      for (const [key, child] of Object.entries(value && typeof value === 'object' ? value : {}))
        select([...path, key], child, item)
    } else {
      for (const [key, childKind] of Object.entries(fields[kind] ?? {})) {
        if (Object.hasOwn(object, key)) select([...path, key], object[key], childKind)
      }
    }
  }
  select(['paths'], record(root).paths, 'paths')
  return selection
}
