import { BodyPayloadValueType } from '../types'
import { transformToBodyPayload } from '../utils'

describe('http utils transformToBodyPayload', () => {
  it('keeps the full value when it contains a colon (issue #38860)', () => {
    const payload = transformToBodyPayload('url:https://example.com:8080/path', true)
    expect(payload).toEqual([
      {
        key: 'url',
        type: BodyPayloadValueType.text,
        value: 'https://example.com:8080/path',
      },
    ])
  })

  it('preserves values with multiple colons across round-trips', () => {
    const raw = 'endpoint:http://host:9000/api:v2'
    const payload = transformToBodyPayload(raw, true)
    expect(payload[0]!.value).toBe('http://host:9000/api:v2')
  })

  it('returns a text-only payload when hasKey is false', () => {
    const payload = transformToBodyPayload('just some raw text', false)
    expect(payload).toEqual([
      {
        type: BodyPayloadValueType.text,
        value: 'just some raw text',
      },
    ])
  })

  it('returns empty value for key-only lines', () => {
    const payload = transformToBodyPayload('content-type', true)
    expect(payload).toEqual([
      {
        key: 'content-type',
        type: BodyPayloadValueType.text,
        value: '',
      },
    ])
  })

  it('parses multiple key-value lines without dropping colons', () => {
    const payload = transformToBodyPayload(
      'url:https://example.com:8080/path\ntoken:abc:def:ghi',
      true,
    )
    expect(payload).toEqual([
      {
        key: 'url',
        type: BodyPayloadValueType.text,
        value: 'https://example.com:8080/path',
      },
      {
        key: 'token',
        type: BodyPayloadValueType.text,
        value: 'abc:def:ghi',
      },
    ])
  })
})
