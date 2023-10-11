export const CONTEXT_PLACEHOLDER_TEXT = '{{#context#}}'
export const HISTORY_PLACEHOLDER_TEXT = '{{#histories#}}'
export const QUERY_PLACEHOLDER_TEXT = '{{#query#}}'
export const PRE_PROMPT_PLACEHOLDER_TEXT = '{{#pre_prompt#}}'

export const checkHasContextBlock = (text: string) => {
  if (!text)
    return false
  return text.includes(CONTEXT_PLACEHOLDER_TEXT)
}

export const checkHasHistoryBlock = (text: string) => {
  if (!text)
    return false
  return text.includes(HISTORY_PLACEHOLDER_TEXT)
}

export const checkHasQueryBlock = (text: string) => {
  if (!text)
    return false
  return text.includes(QUERY_PLACEHOLDER_TEXT)
}
