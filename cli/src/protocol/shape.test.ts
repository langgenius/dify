import { expect, it } from 'vite-plus/test'
import { coerceFor, isRepeatable, labelOf, SHAPE, shapeOf } from './shape'

const binary = { type: 'string', format: 'binary' }
const nullable = (inner: object) => ({ anyOf: [inner, { type: 'null' }], default: null })

it.each([
  [{ type: 'string' }, SHAPE.String, 'string'],
  [{ type: 'integer' }, SHAPE.Integer, 'integer'],
  [{ type: 'boolean' }, SHAPE.Boolean, 'boolean'],
  [{ type: 'string', enum: ['a', 'b'] }, SHAPE.Enum, 'a | b'],
  [binary, SHAPE.File, 'file'],
  [{ type: 'array', items: binary }, SHAPE.List, 'file[]'],
  [{ type: 'array', items: { type: 'string' } }, SHAPE.List, 'string[]'],
  [{ type: 'object', additionalProperties: binary }, SHAPE.Map, 'map<string, file>'],
  [{ type: 'object', additionalProperties: {} }, SHAPE.Map, 'map<string, json>'],
  [{ type: 'object', properties: { a: { type: 'string' } } }, SHAPE.Object, 'object'],
  [nullable({ type: 'string', enum: ['x'] }), SHAPE.Enum, 'x'],
  [{ enum: [] }, SHAPE.Json, 'json'],
  [{ type: 'string', enum: [] }, SHAPE.Json, 'json'],
  [{ oneOf: [{ type: 'string' }, { type: 'integer' }] }, SHAPE.Json, 'json'],
  [{ someFutureKeyword: true }, SHAPE.Json, 'json'],
])('%j classifies as %s labelled %s', (schema, shape, label) => {
  const node = shapeOf(schema)
  expect(node.shape).toBe(shape)
  expect(labelOf(node)).toBe(label)
})

it('coerces by shape and leaves misfits raw for validation', () => {
  expect(coerceFor(shapeOf({ type: 'integer' }))('5')).toBe(5)
  expect(coerceFor(shapeOf({ type: 'integer' }))('x')).toBe('x')
  expect(coerceFor(shapeOf({ type: 'boolean' }))('false')).toBe(false)
  expect(coerceFor(shapeOf({ type: 'object' }))('{"a":1}')).toEqual({ a: 1 })
  expect(coerceFor(shapeOf({ type: 'object' }))('{oops')).toBe('{oops')
  expect(coerceFor(shapeOf({ type: 'object' }))('@vars.json')).toBe('@vars.json')
})

it('a list of scalars or files repeats; a list of objects takes json', () => {
  expect(isRepeatable(shapeOf({ type: 'array', items: { type: 'string' } }))).toBe(true)
  expect(isRepeatable(shapeOf({ type: 'array', items: binary }))).toBe(true)
  expect(isRepeatable(shapeOf({ type: 'array', items: { type: 'object' } }))).toBe(false)
})
