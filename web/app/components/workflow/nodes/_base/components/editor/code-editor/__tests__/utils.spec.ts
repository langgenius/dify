import { serializeCodeEditorValue } from '../utils'

describe('serializeCodeEditorValue', () => {
  it('turns object values into JSON text so Monaco does not treat them as a buffer factory', () => {
    const schema = {
      type: 'object',
      properties: { id: { type: 'string' } },
    }

    expect(serializeCodeEditorValue(schema)).toBe(JSON.stringify(schema, null, 2))
    expect(serializeCodeEditorValue(schema, true)).toBe(JSON.stringify(schema, null, 2))
    expect(serializeCodeEditorValue('{"type":"object"}')).toBe('{"type":"object"}')
    expect(serializeCodeEditorValue(undefined)).toBe('')
    expect(serializeCodeEditorValue(null as never)).toBe('')
  })
})
