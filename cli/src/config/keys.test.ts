import { describe, expect, it } from 'vitest'
import { isBaseError } from '../errors/base.js'
import { ErrorCode } from '../errors/codes.js'
import {
  getKey,
  knownKeyNames,
  knownKeys,
  lookupKey,
  setKey,
  unsetKey,
} from './keys.js'
import { emptyConfig } from './schema.js'

describe('config keys', () => {
  it('exposes the v1.0 key set: defaults.format, defaults.limit, state.current_app', () => {
    expect([...knownKeyNames()].sort()).toEqual(
      ['defaults.format', 'defaults.limit', 'state.current_app'],
    )
  })

  it('knownKeys is alphabetically sorted', () => {
    const names = knownKeys().map(k => k.name)
    const sorted = [...names].sort()
    expect(names).toEqual(sorted)
  })

  it('lookupKey returns the spec by name', () => {
    expect(lookupKey('defaults.format')?.description).toMatch(/format/i)
    expect(lookupKey('nope')).toBeUndefined()
  })

  describe('getKey', () => {
    it('returns empty string for unset values', () => {
      const cfg = emptyConfig()
      expect(getKey(cfg, 'defaults.format')).toBe('')
      expect(getKey(cfg, 'defaults.limit')).toBe('')
      expect(getKey(cfg, 'state.current_app')).toBe('')
    })

    it('throws config_invalid_key for unknown keys', () => {
      let caught: unknown
      try {
        getKey(emptyConfig(), 'nope')
      }
      catch (err) { caught = err }
      expect(isBaseError(caught)).toBe(true)
      if (isBaseError(caught))
        expect(caught.code).toBe(ErrorCode.ConfigInvalidKey)
    })
  })

  describe('setKey', () => {
    it('sets defaults.format when value is in the allowed enum', () => {
      const updated = setKey(emptyConfig(), 'defaults.format', 'json')
      expect(updated.defaults.format).toBe('json')
    })

    it('throws config_invalid_value for unknown format', () => {
      let caught: unknown
      try {
        setKey(emptyConfig(), 'defaults.format', 'csv')
      }
      catch (err) { caught = err }
      expect(isBaseError(caught)).toBe(true)
      if (isBaseError(caught)) {
        expect(caught.code).toBe(ErrorCode.ConfigInvalidValue)
        expect(caught.message).toMatch(/csv/)
      }
    })

    it('sets defaults.limit when value is 1..200', () => {
      const updated = setKey(emptyConfig(), 'defaults.limit', '50')
      expect(updated.defaults.limit).toBe(50)
    })

    it('throws config_invalid_value for limit outside 1..200', () => {
      let caught: unknown
      try {
        setKey(emptyConfig(), 'defaults.limit', '999')
      }
      catch (err) { caught = err }
      expect(isBaseError(caught)).toBe(true)
      if (isBaseError(caught))
        expect(caught.code).toBe(ErrorCode.ConfigInvalidValue)
    })

    it('throws config_invalid_value for non-numeric limit', () => {
      let caught: unknown
      try {
        setKey(emptyConfig(), 'defaults.limit', 'abc')
      }
      catch (err) { caught = err }
      expect(isBaseError(caught)).toBe(true)
      if (isBaseError(caught))
        expect(caught.code).toBe(ErrorCode.ConfigInvalidValue)
    })

    it('sets state.current_app to any string', () => {
      const updated = setKey(emptyConfig(), 'state.current_app', 'app-123')
      expect(updated.state.current_app).toBe('app-123')
    })

    it('returns a new config object (does not mutate the original)', () => {
      const original = emptyConfig()
      const updated = setKey(original, 'defaults.format', 'yaml')
      expect(original.defaults.format).toBeUndefined()
      expect(updated.defaults.format).toBe('yaml')
    })
  })

  describe('unsetKey', () => {
    it('clears a previously-set defaults.format', () => {
      const set = setKey(emptyConfig(), 'defaults.format', 'json')
      const unset = unsetKey(set, 'defaults.format')
      expect(unset.defaults.format).toBeUndefined()
    })

    it('clears a previously-set defaults.limit', () => {
      const set = setKey(emptyConfig(), 'defaults.limit', '99')
      const unset = unsetKey(set, 'defaults.limit')
      expect(unset.defaults.limit).toBeUndefined()
    })

    it('clears state.current_app', () => {
      const set = setKey(emptyConfig(), 'state.current_app', 'app-1')
      const unset = unsetKey(set, 'state.current_app')
      expect(unset.state.current_app).toBeUndefined()
    })

    it('throws config_invalid_key for unknown keys', () => {
      let caught: unknown
      try {
        unsetKey(emptyConfig(), 'nope')
      }
      catch (err) { caught = err }
      expect(isBaseError(caught)).toBe(true)
      if (isBaseError(caught))
        expect(caught.code).toBe(ErrorCode.ConfigInvalidKey)
    })
  })
})
