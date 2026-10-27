import { collectSchemaReferences, pointer, record } from '../document.js'

/** Type-only aliases let TS represent recursive schemas without finite unrolling. */
export function schemaTypes(
  root: unknown,
  schemaReferences = collectSchemaReferences(root),
): string {
  const references = new Map<string, number>()
  const declarations: string[] = []
  const objectTypes = new Map<Record<string, unknown>, Map<boolean, string>>()
  let objectIndex = 0
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
    const cached = objectTypes.get(schema)?.get(json)
    if (cached) return cached
    const properties = record(schema.properties)
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    const fields = Object.entries(properties).map(
      ([name, s]) => `${JSON.stringify(name)}${required.has(name) ? '' : '?'}:${render(s, json)}`,
    )
    const additional = schema.additionalProperties
    // Named interfaces keep recursive properties lazy while oneOf compares the
    // required shape of each branch. Anonymous conditional aliases expand eagerly.
    const shape = fields.length ? `Object${objectIndex++}` : undefined
    if (shape) declarations.push(`interface ${shape} {${fields.join(';')}}`)
    let result: string
    if (additional !== undefined && additional !== false) {
      const values =
        additional === true
          ? ['unknown']
          : [render(additional, json), ...Object.values(properties).map((s) => render(s, json))]
      const index = `{[key:string]:${union(values)}}`
      result = shape ? `(${shape} & ${index})` : index
    } else {
      result = shape ?? `Record<string, ${additional === false ? 'never' : 'unknown'}>`
    }
    const variants = objectTypes.get(schema) ?? new Map<boolean, string>()
    variants.set(json, result)
    objectTypes.set(schema, variants)
    return result
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
  function compositionReference(path: string, json: boolean): string {
    return `${reference(path, json)}Composition`
  }
  function composition(value: unknown, json: boolean): string {
    if (value === false) return '{base:never}'
    if (value === true) return '{base:unknown}'
    const schema = record(value)
    const ref =
      typeof schema.$ref === 'string' ? `ref:${compositionReference(schema.$ref, json)}` : undefined
    if (ref && String(record(root).openapi).startsWith('3.0.')) return `{${ref}}`
    const fields = [`base:${base(schema, json)}`]
    if (ref) fields.push(ref)
    if (Array.isArray(schema.required)) fields.push(`required:${literal(schema.required)}`)
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(schema[key]))
        fields.push(`${key}:[${schema[key].map((child) => composition(child, json)).join(',')}]`)
    }
    if (schema.nullable) fields.push('nullable:true')
    return `{${fields.join(';')}}`
  }
  const intersection = (parts: string[]) => {
    const kept = [...new Set(parts.filter((part) => part !== 'unknown'))]
    return kept.length ? `(${kept.join('&')})` : 'unknown'
  }
  function base(schema: Record<string, unknown>, json: boolean): string {
    return Object.hasOwn(schema, 'const')
      ? literal(schema.const)
      : Array.isArray(schema.enum)
        ? union(schema.enum.map(literal))
        : Array.isArray(schema.type)
          ? union(schema.type.map((type) => primitive(schema, type, json)))
          : primitive(schema, schema.type, json)
  }
  function render(value: unknown, json: boolean, context = 'unknown'): string {
    if (value === false) return 'never'
    if (value === true) return context
    const schema = record(value)
    const ref =
      typeof schema.$ref === 'string'
        ? context === 'unknown'
          ? reference(schema.$ref, json)
          : `import("@dify/openapi-content-mapper").ApplySchemaComposition<${context},${compositionReference(schema.$ref, json)}>`
        : undefined
    if (ref && String(record(root).openapi).startsWith('3.0.')) return ref
    let result = intersection([ref ?? context, base(schema, json)])
    if (Array.isArray(schema.allOf)) {
      result = intersection([result, ...schema.allOf.map((child) => render(child, json))])
      for (const child of schema.allOf) result = render(child, json, result)
    }
    for (const key of ['anyOf', 'oneOf']) {
      if (Array.isArray(schema[key])) {
        const parent = result
        const branches = schema[key].map((child) => render(child, json, parent))
        result =
          key === 'oneOf'
            ? `import("@dify/openapi-content-mapper").ExclusiveUnion<[${branches.join(',')}]>`
            : union(branches)
      }
    }
    const required = Array.isArray(schema.required)
      ? schema.required.filter((key) => typeof key === 'string')
      : []
    if (required.length)
      result = `import("@dify/openapi-content-mapper").RequireSchemaKeys<${result},${union(required.map(literal))}>`
    return schema.nullable ? union([result, intersection([context, 'null'])]) : result
  }
  // Structural references and literal payloads do not create schema aliases.
  for (const path of schemaReferences) reference(path, false)
  for (const [path, index] of references) {
    const schema = pointer(root, path)
    const ordinary = composition(schema, false)
    const json = composition(schema, true)
    declarations.push(`type Schema${index}Composition = ${ordinary};`)
    declarations.push(
      `type JsonSchema${index}Composition = ${json === ordinary ? `Schema${index}Composition` : json};`,
    )
    declarations.push(`type Schema${index} = ${render(schema, false)};`)
    declarations.push(`type JsonSchema${index} = ${render(schema, true)};`)
  }
  declarations.push(
    'type ReadonlyDocument<T> = { readonly [K in keyof T]: T[K] extends object ? ReadonlyDocument<T[K]> : T[K] };',
    'type Document = import("@dify/openapi-content-mapper").SchemaDocument<ReadonlyDocument<typeof document>, {',
  )
  for (const json of [false, true]) {
    declarations.push(`${json ? 'jsonCompositions' : 'compositions'}: {`)
    for (const [path, index] of references)
      declarations.push(
        `${JSON.stringify(path)}: ${json ? 'JsonSchema' : 'Schema'}${index}Composition;`,
      )
    declarations.push('};')
  }
  declarations.push('}>;')
  return `${declarations.join('\n')}\n`
}
