import type { OpenApiDocument } from './types.js'

export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function resolveRef(value: unknown, root: unknown): Record<string, unknown> {
  const seen = new Set<string>()
  let result = record(value)
  while (typeof result.$ref === 'string') {
    const ref = result.$ref
    if (seen.has(ref)) throw new Error(`Circular reference outside a schema: ${ref}`)
    seen.add(ref)
    result = record(pointer(root, ref))
  }
  return result
}

export function pointerPath(ref: string): string[] {
  if (!ref.startsWith('#'))
    throw new Error(`Only local JSON Pointer references are supported: ${ref}`)
  const decoded = `#${decodeURIComponent(ref.slice(1))}`
  if (!decoded.startsWith('#/'))
    throw new Error(`Only local JSON Pointer references are supported: ${ref}`)
  return decoded
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
}

export function pointer(root: unknown, ref: string): unknown {
  let value = root
  for (const key of pointerPath(ref)) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new Error(`Unresolved reference: ${ref}`)
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

export function assertDocument(value: unknown): asserts value is OpenApiDocument {
  const doc = record(value)
  if (typeof doc.openapi !== 'string' || !/^3\.[01]\./.test(doc.openapi))
    throw new Error('Expected an OpenAPI 3.0.x or 3.1.x document')
  if (!doc.paths || typeof doc.paths !== 'object' || Array.isArray(doc.paths))
    throw new Error('OpenAPI document must contain a paths object')
}

/** Validate references only in OpenAPI/schema objects, never in literal payloads. */
export function collectSchemaReferences(root: unknown): Set<string> {
  type Kind =
    | 'document'
    | 'components'
    | 'path'
    | 'operation'
    | 'parameter'
    | 'body'
    | 'response'
    | 'media'
    | 'encoding'
    | 'callback'
    | 'reference'
    | 'schema'
  const fields: Partial<Record<Kind, Record<string, Kind>>> = {
    parameter: { schema: 'schema' },
    media: { schema: 'schema' },
    schema: {
      additionalProperties: 'schema',
      unevaluatedProperties: 'schema',
      propertyNames: 'schema',
      items: 'schema',
      additionalItems: 'schema',
      unevaluatedItems: 'schema',
      contains: 'schema',
      not: 'schema',
      if: 'schema',
      then: 'schema',
      else: 'schema',
    },
  }
  const maps: Partial<Record<Kind, Record<string, Kind>>> = {
    document: { paths: 'path', webhooks: 'path' },
    components: {
      schemas: 'schema',
      responses: 'response',
      parameters: 'parameter',
      headers: 'parameter',
      requestBodies: 'body',
      callbacks: 'callback',
      examples: 'reference',
      links: 'reference',
      securitySchemes: 'reference',
      pathItems: 'path',
    },
    operation: { responses: 'response', callbacks: 'callback' },
    parameter: { content: 'media', examples: 'reference' },
    body: { content: 'media' },
    response: { content: 'media', headers: 'parameter', links: 'reference' },
    media: { examples: 'reference', encoding: 'encoding' },
    encoding: { headers: 'parameter' },
    schema: {
      properties: 'schema',
      patternProperties: 'schema',
      $defs: 'schema',
      definitions: 'schema',
      dependentSchemas: 'schema',
    },
  }
  const arrays: Partial<Record<Kind, Record<string, Kind>>> = {
    path: { parameters: 'parameter' },
    operation: { parameters: 'parameter' },
    schema: { allOf: 'schema', anyOf: 'schema', oneOf: 'schema', prefixItems: 'schema' },
  }
  const references = new Set<string>()
  const visited = new Map<unknown, Set<Kind>>()
  function visit(value: unknown, kind: Kind): void {
    if (!value || typeof value !== 'object') return
    const kinds = visited.get(value) ?? new Set<Kind>()
    if (kinds.has(kind)) return
    kinds.add(kind)
    visited.set(value, kinds)
    const object = record(value)
    if (
      !['document', 'components', 'media', 'encoding'].includes(kind) &&
      typeof object.$ref === 'string'
    ) {
      if (kind === 'schema') references.add(object.$ref)
      visit(pointer(root, object.$ref), kind)
    }
    if (kind === 'document') visit(object.components, 'components')
    if (kind === 'path') {
      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])
        visit(object[method], 'operation')
    }
    if (kind === 'operation') visit(object.requestBody, 'body')
    if (kind === 'callback') {
      for (const [key, child] of Object.entries(object))
        if (key !== '$ref' && !key.startsWith('x-')) visit(child, 'path')
    }
    for (const [key, childKind] of Object.entries(fields[kind] ?? {})) visit(object[key], childKind)
    for (const [key, childKind] of Object.entries(maps[kind] ?? {})) {
      for (const [name, child] of Object.entries(record(object[key]))) {
        // Paths and Responses allow specification extensions; schema property names are data.
        if ((key === 'paths' || key === 'responses') && name.startsWith('x-')) continue
        visit(child, childKind)
      }
    }
    for (const [key, childKind] of Object.entries(arrays[kind] ?? {})) {
      if (Array.isArray(object[key])) for (const child of object[key]) visit(child, childKind)
    }
  }
  visit(root, 'document')
  return references
}
