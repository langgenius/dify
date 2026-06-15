import { jsonConfigPlaceHolder } from '../config'

describe('config modal placeholder config', () => {
  it('should contain a valid object schema example', () => {
    const parsed = JSON.parse(jsonConfigPlaceHolder) as {
      type: string
      properties: {
        foo: { type: string }
        bar: {
          type: string
          properties: {
            sub: { type: string }
          }
        }
      }
    }

    expect(parsed.type).toBe('object')
    expect(parsed.properties.foo.type).toBe('string')
    expect(parsed.properties.bar.type).toBe('object')
    expect(parsed.properties.bar.properties.sub.type).toBe('number')
  })
})
