import { getAvatarInitial } from './avatar'

describe('getAvatarInitial', () => {
  it.each([
    [' alice ', 'A'],
    ['🧑‍💻 Alex', '🧑‍💻'],
    ['𠮷田', '𠮷'],
    ['e\u0301mile', 'E\u0301'],
    ['', '?'],
    ['   ', '?'],
    [undefined, '?'],
  ])('uses the first complete grapheme of %s', (name, expected) => {
    expect(getAvatarInitial(name)).toBe(expected)
  })
})
