import { describe, expect, it } from 'vitest'
import { buildBody, isJSONSerializable } from './body.js'

describe('isJSONSerializable', () => {
  it('rejects undefined', () => {
    expect(isJSONSerializable(undefined)).toBe(false)
  })

  it('accepts null and primitives', () => {
    expect(isJSONSerializable(null)).toBe(true)
    expect(isJSONSerializable('')).toBe(true)
    expect(isJSONSerializable(0)).toBe(true)
    expect(isJSONSerializable(true)).toBe(true)
  })

  it('accepts plain objects and arrays', () => {
    expect(isJSONSerializable({ a: 1 })).toBe(true)
    expect(isJSONSerializable([])).toBe(true)
  })

  it('rejects FormData and URLSearchParams', () => {
    expect(isJSONSerializable(new FormData())).toBe(false)
    expect(isJSONSerializable(new URLSearchParams())).toBe(false)
  })

  it('accepts objects with a toJSON method', () => {
    expect(isJSONSerializable({ toJSON: () => ({}) })).toBe(true)
  })

  it('rejects buffer-like objects', () => {
    expect(isJSONSerializable({ buffer: new ArrayBuffer(1) })).toBe(false)
  })
})

describe('buildBody', () => {
  it('returns no body for GET regardless of json/body input', () => {
    expect(buildBody({ method: 'GET', json: { a: 1 } })).toEqual({
      body: undefined,
      contentType: undefined,
    })
    expect(buildBody({ method: 'GET', body: 'x' })).toEqual({
      body: undefined,
      contentType: undefined,
    })
  })

  it('serializes json and sets Content-Type on payload methods', () => {
    const { body, contentType } = buildBody({ method: 'POST', json: { a: 1 } })
    expect(body).toBe('{"a":1}')
    expect(contentType).toBe('application/json')
  })

  it('passes raw body through without Content-Type injection', () => {
    const form = new FormData()
    const { body, contentType } = buildBody({ method: 'POST', body: form })
    expect(body).toBe(form)
    expect(contentType).toBeUndefined()
  })

  it('prefers json over body when both are supplied', () => {
    const { body, contentType } = buildBody({ method: 'POST', json: { a: 1 }, body: 'raw' })
    expect(body).toBe('{"a":1}')
    expect(contentType).toBe('application/json')
  })

  it('returns null body when neither json nor body is supplied', () => {
    expect(buildBody({ method: 'POST' })).toEqual({ body: undefined, contentType: undefined })
  })
})
