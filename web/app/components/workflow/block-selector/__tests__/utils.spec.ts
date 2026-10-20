import { pinyin } from 'pinyin-pro'
import { describe, expect, it } from 'vite-plus/test'
import { compareProviderLetters, getProviderLetter } from '../utils'

describe('provider letter grouping', () => {
  it('preserves the pinyin-pro grouping of every supported Chinese character', () => {
    const differences: string[] = []
    for (let code = 0x4e00; code <= 0x9fa5; code++) {
      const character = String.fromCharCode(code)
      const initial = (
        pinyin(character, { pattern: 'first', toneType: 'none' })[0] || character
      ).toUpperCase()
      const expected = /[A-Z]/.test(initial) ? initial : '#'
      if (getProviderLetter(character) !== expected) differences.push(character)
    }
    expect(differences).toEqual([])
  })

  it.each([
    ['a', 'A'],
    ['Z', 'Z'],
    ['1', '#'],
    ['-', '#'],
    ['', '#'],
    ['é', '#'],
    ['〇', '#'],
    ['龦', '#'],
    ['😀', '#'],
    ['重', 'Z'],
    ['长', 'C'],
    ['行', 'X'],
  ])('groups %j under %s', (character, expected) => {
    expect(getProviderLetter(character)).toBe(expected)
  })

  it('sorts letters alphabetically and places the fallback group last', () => {
    expect(['#', 'Z', 'A', 'C', 'A'].sort(compareProviderLetters)).toEqual([
      'A',
      'A',
      'C',
      'Z',
      '#',
    ])
  })
})
