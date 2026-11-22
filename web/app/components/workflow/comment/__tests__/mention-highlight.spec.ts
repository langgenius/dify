import { findMentions } from '../mention-highlight'

const names = (content: string, mentionNames: string[]) =>
  findMentions(content, mentionNames).map((mention) => mention.name)

describe('findMentions', () => {
  it('finds each @name that starts the text or follows whitespace', () => {
    expect(names('@Bob and @Ann, look', ['Bob', 'Ann'])).toEqual(['Bob', 'Ann'])
  })

  it('skips an @ inside a word and still finds the mention after it', () => {
    expect(names('me@Bob.com then @Bob', ['Bob'])).toEqual(['Bob'])
  })

  it('does not take a longer word for a name', () => {
    expect(names('@Bobby please review', ['Bob'])).toEqual([])
  })

  it('does not end a name inside a character outside the basic plane', () => {
    expect(names('@Bob𠮷 hi', ['Bob'])).toEqual([])
  })

  it('takes the longest name that fits where names share a prefix', () => {
    expect(names('@Bob Smith here', ['Bob', 'Bob Smith'])).toEqual(['Bob Smith'])
  })

  it('ends a mention at punctuation', () => {
    expect(findMentions('Thanks @Bob!', ['Bob'])).toEqual([{ start: 7, end: 11, name: 'Bob' }])
  })
})
