import {
  buildFileReferenceToken,
  getFileReferenceTokenRegexString,
  parseFileReferenceToken,
} from '../utils'

const resourceId = '11111111-1111-4111-8111-111111111111'

describe('file-reference utils', () => {
  it('should expose a regex that matches serialized file tokens', () => {
    const regex = new RegExp(`^${getFileReferenceTokenRegexString()}$`)

    expect(regex.test(buildFileReferenceToken(resourceId))).toBe(true)
    expect(regex.test('§[file].[app].[invalid]§')).toBe(false)
  })

  it('should parse valid file tokens and reject invalid content', () => {
    expect(parseFileReferenceToken(buildFileReferenceToken(resourceId))).toEqual({
      resourceId,
    })
    expect(parseFileReferenceToken('plain-text')).toBeNull()
    expect(parseFileReferenceToken('§[file].[app].[short-id]§')).toBeNull()
  })

  it('should build file reference tokens from resource ids', () => {
    expect(buildFileReferenceToken(resourceId)).toBe(`§[file].[app].[${resourceId}]§`)
  })
})
