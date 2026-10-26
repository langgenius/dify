import { BodyPayloadValueType } from '../types'
import { transformToBodyPayload } from '../utils'

describe('transformToBodyPayload', () => {
  // Bodies without a key (json, raw-text, binary) keep the raw string untouched.
  describe('when hasKey is false', () => {
    it('should keep the whole string as a single text value', () => {
      const result = transformToBodyPayload('{"url":"https://a:1"}', false)

      expect(result).toEqual([{ type: BodyPayloadValueType.text, value: '{"url":"https://a:1"}' }])
    })
  })

  // form-data / x-www-form-urlencoded bodies are stored as `key:value` lines.
  describe('when hasKey is true', () => {
    it('should parse each line independently', () => {
      const result = transformToBodyPayload('name:alice\nurl:https://host:8080/path', true)

      expect(result).toEqual([
        { key: 'name', type: BodyPayloadValueType.text, value: 'alice' },
        { key: 'url', type: BodyPayloadValueType.text, value: 'https://host:8080/path' },
      ])
    })

    it('should use an empty value when the line has no colon', () => {
      const result = transformToBodyPayload('lonelykey', true)

      expect(result).toEqual([{ key: 'lonelykey', type: BodyPayloadValueType.text, value: '' }])
    })
  })
})
