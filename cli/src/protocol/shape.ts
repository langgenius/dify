import type { JsonSchema } from '@/plugins/catalog'
import { isRecord } from '@/util/is-record'

export const SHAPE = {
  String: 'string',
  Integer: 'integer',
  Number: 'number',
  Boolean: 'boolean',
  Enum: 'enum',
  File: 'file',
  List: 'list',
  Map: 'map',
  Object: 'object',
  Json: 'json',
  Union: 'union',
} as const
export type Shape = (typeof SHAPE)[keyof typeof SHAPE]
export type ShapeNode = Readonly<{
  shape: Shape
  item?: ShapeNode
  values?: readonly string[]
  alternatives?: readonly ShapeNode[]
}>

type Coercion = (raw: string) => unknown

const NULL_TYPE = 'null'
const BINARY_FORMAT = 'binary'
const ARRAY_TYPE = 'array'
const OBJECT_TYPE = 'object'
const STRING_TYPE = 'string'
const FILE_REF_PREFIX = '@'
const ALTERNATIVE_SEPARATOR = ' | '
const BOOLEAN_LITERALS: Readonly<Record<string, boolean>> = { true: true, false: false }

const keepRaw: Coercion = (raw) => raw
const toNumber: Coercion = (raw) => {
  if (raw.trim() === '') return raw
  const n = Number(raw)
  return Number.isFinite(n) ? n : raw
}
const toBoolean: Coercion = (raw) => BOOLEAN_LITERALS[raw] ?? raw
// An @file reference is resolved later by the caller that can read files.
const toJson: Coercion = (raw) => {
  if (raw.startsWith(FILE_REF_PREFIX)) return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

const JSON_NODE: ShapeNode = { shape: SHAPE.Json }
const SCALAR_TYPES: Readonly<Record<string, Shape>> = {
  string: SHAPE.String,
  integer: SHAPE.Integer,
  number: SHAPE.Number,
  boolean: SHAPE.Boolean,
}

type ShapeInfo = Readonly<{
  label: (node: ShapeNode) => string
  coerce: (node: ShapeNode) => Coercion
  scalar: boolean
}>

const SHAPE_INFO: Readonly<Record<Shape, ShapeInfo>> = {
  [SHAPE.String]: { label: () => SHAPE.String, coerce: () => keepRaw, scalar: true },
  [SHAPE.Integer]: { label: () => SHAPE.Integer, coerce: () => toNumber, scalar: true },
  [SHAPE.Number]: { label: () => SHAPE.Number, coerce: () => toNumber, scalar: true },
  [SHAPE.Boolean]: { label: () => SHAPE.Boolean, coerce: () => toBoolean, scalar: true },
  [SHAPE.Enum]: {
    label: (n) => (n.values ?? []).join(ALTERNATIVE_SEPARATOR),
    coerce: () => keepRaw,
    scalar: true,
  },
  [SHAPE.File]: { label: () => SHAPE.File, coerce: () => keepRaw, scalar: true },
  [SHAPE.List]: {
    label: (n) => `${labelOf(n.item ?? JSON_NODE)}[]`,
    coerce: (n) => (isRepeatable(n) ? coerceFor(n.item ?? JSON_NODE) : toJson),
    scalar: false,
  },
  [SHAPE.Map]: {
    label: (n) => `map<string, ${labelOf(n.item ?? JSON_NODE)}>`,
    coerce: () => toJson,
    scalar: false,
  },
  [SHAPE.Object]: { label: () => SHAPE.Object, coerce: () => toJson, scalar: false },
  [SHAPE.Json]: { label: () => SHAPE.Json, coerce: () => toJson, scalar: false },
  [SHAPE.Union]: {
    label: (n) => (n.alternatives ?? []).map(labelOf).join(ALTERNATIVE_SEPARATOR),
    coerce: () => toJson,
    scalar: false,
  },
}

// One list of branches, from anyOf or oneOf. A schema with both is not one union, so it
// reads as no alternatives and falls through to its type.
function alternativesOf(schema: JsonSchema): JsonSchema[] {
  const lists = [schema.anyOf, schema.oneOf].filter(Array.isArray)
  const [branches] = lists
  if (lists.length !== 1 || branches === undefined) return []
  return branches.filter((b) => isRecord(b) && b.type !== NULL_TYPE) as JsonSchema[]
}

export function shapeOf(schema: JsonSchema): ShapeNode {
  const alternatives = alternativesOf(schema)
  const [only] = alternatives
  if (alternatives.length === 1 && only !== undefined) return shapeOf(only)
  if (alternatives.length > 1)
    return { shape: SHAPE.Union, alternatives: alternatives.map(shapeOf) }
  const type = typeof schema.type === 'string' ? schema.type : undefined
  // An enum with no members names no value at all, so it degrades to json rather than
  // labelling as the empty string.
  if (Array.isArray(schema.enum))
    return schema.enum.length === 0
      ? JSON_NODE
      : { shape: SHAPE.Enum, values: schema.enum.map(String) }
  if (type === STRING_TYPE && schema.format === BINARY_FORMAT) return { shape: SHAPE.File }
  if (type !== undefined && type in SCALAR_TYPES) return { shape: SCALAR_TYPES[type] as Shape }
  if (type === ARRAY_TYPE)
    return {
      shape: SHAPE.List,
      item: isRecord(schema.items) ? shapeOf(schema.items as JsonSchema) : JSON_NODE,
    }
  if (type === OBJECT_TYPE && isRecord(schema.properties)) return { shape: SHAPE.Object }
  if (type === OBJECT_TYPE) {
    const extra = schema.additionalProperties
    return {
      shape: SHAPE.Map,
      item:
        isRecord(extra) && Object.keys(extra).length > 0 ? shapeOf(extra as JsonSchema) : JSON_NODE,
    }
  }
  return JSON_NODE
}

export function propertiesOf(schema: JsonSchema): Record<string, JsonSchema> {
  return isRecord(schema.properties) ? (schema.properties as Record<string, JsonSchema>) : {}
}

export function labelOf(node: ShapeNode): string {
  return SHAPE_INFO[node.shape].label(node)
}
export function coerceFor(node: ShapeNode): Coercion {
  return SHAPE_INFO[node.shape].coerce(node)
}
export function isScalar(node: ShapeNode): boolean {
  return SHAPE_INFO[node.shape].scalar
}
export function isRepeatable(node: ShapeNode): boolean {
  return node.shape === SHAPE.List && node.item !== undefined && isScalar(node.item)
}
export function takesValue(node: ShapeNode): boolean {
  return node.shape !== SHAPE.Boolean
}
