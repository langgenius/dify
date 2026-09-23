import { pinyin } from 'pinyin-pro'

export function getProviderLetter(firstChar: string) {
  const pinyinInitial = /[\u4E00-\u9FA5]/.test(firstChar)
    ? pinyin(firstChar, { pattern: 'first', toneType: 'none' })[0]
    : firstChar
  const letter = (pinyinInitial || firstChar).toUpperCase()

  return /[A-Z]/.test(letter) ? letter : '#'
}

export function compareProviderLetters(left: string, right: string) {
  if (left === right) return 0
  if (left === '#') return 1
  if (right === '#') return -1
  return left.localeCompare(right)
}
