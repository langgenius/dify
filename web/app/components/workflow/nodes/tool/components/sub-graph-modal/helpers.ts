import type { PromptItem, PromptTemplateItem } from '@/app/components/workflow/types'
import { EditionType, isPromptMessageContext, PromptRole } from '@/app/components/workflow/types'

export const resolveSubGraphPromptText = (item?: PromptItem) => {
  if (!item)
    return ''
  if (item.edition_type === EditionType.jinja2)
    return item.jinja2_text || item.text || ''
  return item.text || ''
}

export const getSubGraphUserPromptText = (promptTemplate?: PromptTemplateItem[] | PromptItem) => {
  if (!promptTemplate)
    return ''
  if (Array.isArray(promptTemplate)) {
    for (const item of promptTemplate) {
      if (!isPromptMessageContext(item) && item.role === PromptRole.user)
        return resolveSubGraphPromptText(item)
    }
    return ''
  }
  return resolveSubGraphPromptText(promptTemplate)
}

export const resolveSubGraphAssembleOutputSelector = (
  rawSelector: unknown,
  outputKeys: string[],
  extractorNodeId: string,
) => {
  if (outputKeys.length === 0)
    return null
  const normalizedSelector = Array.isArray(rawSelector)
    ? (rawSelector[0] === extractorNodeId ? rawSelector.slice(1) : rawSelector)
    : []
  const currentKey = normalizedSelector[0]
  const fallbackKey = outputKeys.includes('result') ? 'result' : outputKeys[0]
  const nextKey = outputKeys.includes(currentKey) ? currentKey : fallbackKey
  if (!nextKey || nextKey === currentKey)
    return null
  return [nextKey, ...normalizedSelector.slice(1)]
}
