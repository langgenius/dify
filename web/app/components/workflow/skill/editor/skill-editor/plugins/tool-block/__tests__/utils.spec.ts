import {
  buildToolToken,
  buildToolTokenList,
  getToolTokenListRegexString,
  getToolTokenRegexString,
  parseToolToken,
  parseToolTokenList,
} from '../utils'

const firstToken = {
  provider: 'openai/tools',
  tool: 'search',
  configId: '11111111-1111-4111-8111-111111111111',
}

const secondToken = {
  provider: 'anthropic',
  tool: 'browse',
  configId: '22222222-2222-4222-8222-222222222222',
}

describe('tool-block utils', () => {
  it('should expose regexes that match tool tokens and token lists', () => {
    const tokenRegex = new RegExp(`^${getToolTokenRegexString()}$`)
    const listRegex = new RegExp(`^${getToolTokenListRegexString()}$`)

    expect(tokenRegex.test(buildToolToken(firstToken))).toBe(true)
    expect(tokenRegex.test('§[tool].[bad token]§')).toBe(false)
    expect(listRegex.test(buildToolTokenList([firstToken, secondToken]))).toBe(true)
  })

  it('should parse tool tokens and token lists', () => {
    expect(parseToolToken(buildToolToken(firstToken))).toEqual(firstToken)
    expect(parseToolToken('plain-text')).toBeNull()
    expect(parseToolTokenList(buildToolTokenList([firstToken, secondToken]))).toEqual([
      firstToken,
      secondToken,
    ])
    expect(parseToolTokenList('[plain-text')).toBeNull()
    expect(parseToolTokenList('[]')).toBeNull()
    expect(parseToolTokenList('[ , ]')).toBeNull()
    expect(parseToolTokenList('[plain-text]')).toBeNull()
  })

  it('should build serialized tool tokens and lists', () => {
    expect(buildToolToken(firstToken)).toBe('§[tool].[openai/tools].[search].[11111111-1111-4111-8111-111111111111]§')
    expect(buildToolTokenList([firstToken, secondToken])).toBe(
      `[${buildToolToken(firstToken)},${buildToolToken(secondToken)}]`,
    )
  })
})
