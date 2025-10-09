import { MARKETPLACE_URL_PREFIX, MAX_VAR_KEY_LENGTH, VAR_ITEM_TEMPLATE, VAR_ITEM_TEMPLATE_IN_WORKFLOW, getMaxVarNameLength } from '@/config'
import {
  CONTEXT_PLACEHOLDER_TEXT,
  HISTORY_PLACEHOLDER_TEXT,
  PRE_PROMPT_PLACEHOLDER_TEXT,
  QUERY_PLACEHOLDER_TEXT,
} from '@/app/components/base/prompt-editor/constants'
import type { InputVar } from '@/app/components/workflow/types'
import { InputVarType } from '@/app/components/workflow/types'

const otherAllowedRegex = /^\w+$/

export const getNewVar = (key: string, type: string) => {
  const { ...rest } = VAR_ITEM_TEMPLATE
  if (type !== 'string') {
    return {
      ...rest,
      type: type || 'string',
      key,
      name: key.slice(0, getMaxVarNameLength(key)),
    }
  }
  return {
    ...VAR_ITEM_TEMPLATE,
    type: type || 'string',
    key,
    name: key.slice(0, getMaxVarNameLength(key)),
  }
}

export const getNewVarInWorkflow = (key: string, type = InputVarType.textInput): InputVar => {
  const { max_length: _maxLength, ...rest } = VAR_ITEM_TEMPLATE_IN_WORKFLOW
  if (type !== InputVarType.textInput) {
    return {
      ...rest,
      type,
      variable: key,
      label: key.slice(0, getMaxVarNameLength(key)),
    }
  }
  return {
    ...VAR_ITEM_TEMPLATE_IN_WORKFLOW,
    type,
    variable: key,
    label: key.slice(0, getMaxVarNameLength(key)),
    placeholder: '',
    default: '',
    hint: '',
  }
}

export const checkKey = (key: string, canBeEmpty?: boolean, _keys?: string[]) => {
  if (key.length === 0 && !canBeEmpty)
    return 'canNoBeEmpty'

  if (canBeEmpty && key === '')
    return true

  if (key.length > MAX_VAR_KEY_LENGTH)
    return 'tooLong'

  if (otherAllowedRegex.test(key)) {
    if (/\d/.test(key[0]))
      return 'notStartWithNumber'

    return true
  }
  return 'notValid'
}

export const checkKeys = (keys: string[], canBeEmpty?: boolean) => {
  let isValid = true
  let errorKey = ''
  let errorMessageKey = ''
  keys.forEach((key) => {
    if (!isValid)
      return

    const res = checkKey(key, canBeEmpty)
    if (res !== true) {
      isValid = false
      errorKey = key
      errorMessageKey = res
    }
  })
  return { isValid, errorKey, errorMessageKey }
}

export const hasDuplicateStr = (strArr: string[]) => {
  const strObj: Record<string, number> = {}
  strArr.forEach((str) => {
    if (strObj[str])
      strObj[str] += 1
    else
      strObj[str] = 1
  })
  return !!Object.keys(strObj).find(key => strObj[key] > 1)
}

const varRegex = /\{\{([a-zA-Z_]\w*)\}\}/g
export const getVars = (value: string) => {
  if (!value)
    return []

  const keys = value.match(varRegex)?.filter((item) => {
    return ![CONTEXT_PLACEHOLDER_TEXT, HISTORY_PLACEHOLDER_TEXT, QUERY_PLACEHOLDER_TEXT, PRE_PROMPT_PLACEHOLDER_TEXT].includes(item)
  }).map((item) => {
    return item.replace('{{', '').replace('}}', '')
  }).filter(key => key.length <= MAX_VAR_KEY_LENGTH) || []
  const keyObj: Record<string, boolean> = {}
  // remove duplicate keys
  const res: string[] = []
  keys.forEach((key) => {
    if (keyObj[key])
      return

    keyObj[key] = true
    res.push(key)
  })
  return res
}

// Set the value of basePath
// example: /dify
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

export function getMarketplaceUrl(path: string, params?: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams({ source: encodeURIComponent(window.location.origin) })
  if (params) {
    Object.keys(params).forEach((key) => {
      const value = params[key]
      if (value !== undefined && value !== null)
        searchParams.append(key, value)
    })
  }
  return `${MARKETPLACE_URL_PREFIX}${path}?${searchParams.toString()}`
}

export const replaceSpaceWithUnderscoreInVarNameInput = (input: HTMLInputElement) => {
  const start = input.selectionStart
  const end = input.selectionEnd

  input.value = input.value.replaceAll(' ', '_')

  if (start !== null && end !== null)
    input.setSelectionRange(start, end)
}
