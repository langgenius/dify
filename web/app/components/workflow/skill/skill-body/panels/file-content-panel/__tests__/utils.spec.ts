import { extractFileReferenceIds, parseSkillFileMetadata } from '../utils'

describe('file-content-panel utils', () => {
  describe('extractFileReferenceIds', () => {
    it('should collect distinct file reference ids from rich text content', () => {
      const content = [
        '§[file].[app].[11111111-1111-4111-8111-111111111111]§',
        'plain text',
        '§[file].[app].[22222222-2222-4222-8222-222222222222]§',
        '§[file].[app].[11111111-1111-4111-8111-111111111111]§',
      ].join('\n')

      expect([...extractFileReferenceIds(content)]).toEqual([
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      ])
    })
  })

  describe('parseSkillFileMetadata', () => {
    it('should return an empty object for missing and invalid metadata inputs', () => {
      expect(parseSkillFileMetadata(undefined)).toEqual({})
      expect(parseSkillFileMetadata(null)).toEqual({})
      expect(parseSkillFileMetadata(1)).toEqual({})
      expect(parseSkillFileMetadata('not-json')).toEqual({})
      expect(parseSkillFileMetadata('"text"')).toEqual({})
    })

    it('should parse object-shaped metadata from JSON strings and objects', () => {
      expect(parseSkillFileMetadata('{"title":"Skill"}')).toEqual({ title: 'Skill' })

      const metadata = { files: { 'guide.md': { id: 'file-1' } } }
      expect(parseSkillFileMetadata(metadata)).toBe(metadata)
    })
  })
})
