import { buildTemplateCsvContent, getExampleValue } from '../input-fields-utils'

describe('input fields utils', () => {
  describe('buildTemplateCsvContent', () => {
    it('should use index as the first CSV column and append expected_output as the last CSV column', () => {
      expect(buildTemplateCsvContent([
        { name: 'query', type: 'string' },
        { name: 'context', type: 'string' },
      ])).toBe('index,query,context,expected_output\n')
    })

    it('should not duplicate expected_output when it already exists', () => {
      expect(buildTemplateCsvContent([
        { name: 'query', type: 'string' },
        { name: 'expected_output', type: 'string' },
      ])).toBe('index,query,expected_output\n')
    })

    it('should not duplicate index when it already exists', () => {
      expect(buildTemplateCsvContent([
        { name: 'query', type: 'string' },
        { name: 'index', type: 'number' },
      ])).toBe('index,query,expected_output\n')
    })

    it('should escape CSV column names before appending expected_output', () => {
      expect(buildTemplateCsvContent([
        { name: 'query,text', type: 'string' },
        { name: 'answer "draft"', type: 'string' },
      ])).toBe('index,"query,text","answer ""draft""",expected_output\n')
    })
  })

  describe('getExampleValue', () => {
    it('should use a row number example for index fields', () => {
      expect(getExampleValue({ name: 'index', type: 'number' }, 'True')).toBe('1')
    })
  })
})
