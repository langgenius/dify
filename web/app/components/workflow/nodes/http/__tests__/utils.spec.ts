import { BodyPayloadValueType } from '../types'
import { transformToBodyPayload } from '../utils'

describe('transformToBodyPayload', () => {
  // Bodies without a key (json, raw-text, binary) keep the raw string untouched.
  describe('when hasKey is false', () => {
    it('should keep the whole string as a single text value', () => {
      const result = transformToBodyPayload('{"url":"https://a:1"}', false)

      expect(result).toEqual([
        { type: BodyPayloadValueType.text, value: '{"url":"https://a:1"}' },
      ])
    })
  })

  // form-data / x-www-form-urlencoded bodies are stored as `key:value` lines.
  describe('when hasKey is true', () => {
    it('should split a simple key:value pair', () => {
      const result = transformToBodyPayload('name:alice', true)

      expect(result).toEqual([
        { key: 'name', type: BodyPayloadValueType.text, value: 'alice' },
      ])
    })

    it('should keep colons that belong to the value', () => {
      const result = transformToBodyPayload('url:https://host:8080/path', true)

      expect(result[0]).toEqual({
        key: 'url',
        type: BodyPayloadValueType.text,
        value: 'https://host:8080/path',
      })
    })

    it('should parse each line independently', () => {
      const result = transformToBodyPayload('a:1\nb:2:3', true)

      expect(result).toEqual([
        { key: 'a', type: BodyPayloadValueType.text, value: '1' },
        { key: 'b', type: BodyPayloadValueType.text, value: '2:3' },
      ])
    })

    it('should use an empty value when the line has no colon', () => {
      const result = transformToBodyPayload('lonelykey', true)

      expect(result).toEqual([
        { key: 'lonelykey', type: BodyPayloadValueType.text, value: '' },
      ])
    })
  })
})
