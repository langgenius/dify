import { collectSchemaReferences, pointer, record } from '../document.js'

/** Type-only aliases let TS represent recursive schemas without finite unrolling. */
export function schemaTypes(
  root: unknown,
  schemaReferences = collectSchemaReferences(root),
): string {
  const references = new Map<string, number>()
  const declarations: string[] = []
  function reference(path: string, json: boolean): string {
    if (!references.has(path)) references.set(path, references.size)
    return `${json ? 'JsonSchema' : 'Schema'}${references.get(path)}`
  }
  function literal(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(literal).join(',')}]`
    if (value && typeof value === 'object')
      return `{${Object.entries(value)
        .map(([key, v]) => `${JSON.stringify(key)}:${literal(v)}`)
        .join(';')}}`
    return JSON.stringify(value) ?? 'unknown'
  }
  const union = (types: string[]) => (types.length ? `(${[...new Set(types)].join('|')})` : 'never')
  function object(schema: Record<string, unknown>, json: boolean): string {
    const properties = record(schema.properties)
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    const fields = Object.entries(properties).map(
      ([name, s]) => `${JSON.stringify(name)}${required.has(name) ? '' : '?'}:${render(s, json)}`,
    )
    const additional = schema.additionalProperties
    if (additional !== undefined && additional !== false) {
      const values =
        additional === true
          ? ['unknown']
          : [render(additional, json), ...Object.values(properties).map((s) => render(s, json))]
      const index = `{[key:string]:${union(values)}}`
      return fields.length ? `({${fields.join(';')}} & ${index})` : index
    }
    return fields.length
      ? `{${fields.join(';')}}`
      : `Record<string, ${additional === false ? 'never' : 'unknown'}>`
  }
  function primitive(schema: Record<string, unknown>, type: unknown, json: boolean): string {
    switch (type) {
      case 'string':
        return schema.format === 'binary' && !json ? 'Blob' : 'string'
      case 'number':
      case 'integer':
        return 'number'
      case 'boolean':
        return 'boolean'
      case 'null':
        return 'null'
      case 'array':
        return `(${render(schema.items ?? true, json)})[]`
      case 'object':
        return object(schema, json)
      default:
        return schema.properties ? object(schema, json) : 'unknown'
    }
  }
  function render(value: unknown, json: boolean): string {
    if (value === false) return 'never'
    if (value === true) return 'unknown'
    const schema = record(value)
    const ref = typeof schema.$ref === 'string' ? reference(schema.$ref, json) : undefined
    if (ref && String(record(root).openapi).startsWith('3.0.')) return ref
    const base = Object.hasOwn(schema, 'const')
      ? literal(schema.const)
      : Array.isArray(schema.enum)
        ? union(schema.enum.map(literal))
        : Array.isArray(schema.type)
          ? union(schema.type.map((t) => primitive(schema, t, json)))
          : primitive(schema, schema.type, json)
    const parts = ref ? [ref, base] : [base]
    for (const key of ['anyOf', 'oneOf']) {
      const alternatives = schema[key]
      if (Array.isArray(alternatives)) parts.push(union(alternatives.map((s) => render(s, json))))
    }
    if (Array.isArray(schema.allOf)) parts.push(...schema.allOf.map((s) => render(s, json)))
    const intersection = parts.filter((p) => p !== 'unknown')
    const combined = intersection.length ? `(${intersection.join('&')})` : 'unknown'
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key) => typeof key === 'string')
      : []
    const result = required.length
      ? `import("@dify/openapi-content-mapper").RequireSchemaKeys<${combined}, ${union(required.map((key) => JSON.stringify(key)))}>`
      : combined
    return schema.nullable ? `(${result}|null)` : result
  }
  // Structural references and literal payloads do not create schema aliases.
  for (const path of schemaReferences) reference(path, false)
  for (const [path, index] of references) {
    const schema = pointer(root, path)
    const ordinary = render(schema, false)
    const json = render(schema, true)
    declarations.push(`type Schema${index} = ${ordinary};`)
    declarations.push(`type JsonSchema${index} = ${json === ordinary ? `Schema${index}` : json};`)
  }
  declarations.push(
    'type ReadonlyDocument<T> = { readonly [K in keyof T]: T[K] extends object ? ReadonlyDocument<T[K]> : T[K] };',
    'type Document = import("@dify/openapi-content-mapper").SchemaDocument<ReadonlyDocument<typeof document>, {',
  )
  for (const json of [false, true]) {
    declarations.push(`${json ? 'json' : 'default'}: {`)
    for (const [path, index] of references)
      declarations.push(`${JSON.stringify(path)}: ${json ? 'JsonSchema' : 'Schema'}${index};`)
    declarations.push('};')
  }
  declarations.push('}>;')
  return `${declarations.join('\n')}\n`
}
