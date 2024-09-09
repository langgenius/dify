import { MAX_VAR_KEY_LENGTH, VAR_ITEM_TEMPLATE, VAR_ITEM_TEMPLATE_IN_WORKFLOW, getMaxVarNameLength } from '@/config'
import { CONTEXT_PLACEHOLDER_TEXT, HISTORY_PLACEHOLDER_TEXT, PRE_PROMPT_PLACEHOLDER_TEXT, QUERY_PLACEHOLDER_TEXT } from '@/app/components/base/prompt-editor/constants'
import { InputVarType } from '@/app/components/workflow/types'

const otherAllowedRegex = /^[a-zA-Z0-9_]+$/

export const getNewVar = (key: string, type: string) => {
  const { max_length, ...rest } = VAR_ITEM_TEMPLATE
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

export const getNewVarInWorkflow = (key: string, type = InputVarType.textInput) => {
  const { max_length, ...rest } = VAR_ITEM_TEMPLATE_IN_WORKFLOW
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
  }
}

export const checkKey = (key: string, canBeEmpty?: boolean) => {
  if (key.length === 0 && !canBeEmpty)
    return 'canNoBeEmpty'

  if (canBeEmpty && key === '')
    return true

  if (key.length > MAX_VAR_KEY_LENGTH)
    return 'tooLong'

  if (otherAllowedRegex.test(key)) {
    if (/[0-9]/.test(key[0]))
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

const varRegex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g
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
