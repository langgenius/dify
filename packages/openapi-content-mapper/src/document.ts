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
  if (!ref.startsWith('#/'))
    throw new Error(`Only local JSON Pointer references are supported: ${ref}`)
  return ref
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
