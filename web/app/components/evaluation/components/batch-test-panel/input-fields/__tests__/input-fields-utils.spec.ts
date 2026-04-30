import { buildTemplateCsvContent } from '../input-fields-utils'

describe('input fields utils', () => {
  describe('buildTemplateCsvContent', () => {
    it('should append expected_output as the last CSV column', () => {
      expect(buildTemplateCsvContent([
        { name: 'query', type: 'string' },
        { name: 'context', type: 'string' },
      ])).toBe('query,context,expected_output\n')
    })

    it('should not duplicate expected_output when it already exists', () => {
      expect(buildTemplateCsvContent([
        { name: 'query', type: 'string' },
        { name: 'expected_output', type: 'string' },
      ])).toBe('query,expected_output\n')
    })

    it('should escape CSV column names before appending expected_output', () => {
      expect(buildTemplateCsvContent([
        { name: 'query,text', type: 'string' },
        { name: 'answer "draft"', type: 'string' },
      ])).toBe('"query,text","answer ""draft""",expected_output\n')
    })
  })
})
