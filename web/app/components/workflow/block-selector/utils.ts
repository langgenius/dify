import { providerInitials } from './provider-initials.generated'

export function getProviderLetter(firstChar: string) {
  const code = firstChar.charCodeAt(0)
  const pinyinInitial =
    code >= 0x4e00 && code <= 0x9fa5 ? providerInitials[code - 0x4e00] : firstChar
  const letter = (pinyinInitial || firstChar).toUpperCase()

  return /[A-Z]/.test(letter) ? letter : '#'
}

export function compareProviderLetters(left: string, right: string) {
  if (left === right) return 0
  if (left === '#') return 1
  if (right === '#') return -1
  return left.localeCompare(right)
}
