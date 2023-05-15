import { VAR_ITEM_TEMPLATE, getMaxVarNameLength, zhRegex, emojiRegex, MAX_VAR_KEY_LENGHT } from "@/config"
const otherAllowedRegex = new RegExp(`^[a-zA-Z0-9_]+$`)

export const getNewVar = (key: string) => {
  return {
    ...VAR_ITEM_TEMPLATE,
    key,
    name: key.slice(0, getMaxVarNameLength(key)),
  }
}

const checkKey = (key: string, canBeEmpty?: boolean) => {
  if (key.length === 0 && !canBeEmpty) {
    return 'canNoBeEmpty'
  }
  if (canBeEmpty && key === '') {
    return true
  }
  if (key.length > MAX_VAR_KEY_LENGHT) {
    return 'tooLong'
  }
  if (otherAllowedRegex.test(key)) {
    if (/[0-9]/.test(key[0])) {
      return 'notStartWithNumber'
    }
    return true
  }
  return 'notValid'
}

export const checkKeys = (keys: string[], canBeEmpty?: boolean) => {
  let isValid = true
  let errorKey = ''
  let errorMessageKey = ''
  keys.forEach((key) => {
    if (!isValid) {
      return
    }
    const res = checkKey(key, canBeEmpty)
    if (res !== true) {
      isValid = false
      errorKey = key
      errorMessageKey = res
    }
  })
  return { isValid, errorKey, errorMessageKey }
}