import type { ToolWithProvider } from '../types'
import { pinyin } from 'pinyin-pro'
import { CollectionType } from '../../tools/types'

export const CUSTOM_GROUP_NAME = '@@@custom@@@'
export const WORKFLOW_GROUP_NAME = '@@@workflow@@@'
export const DATA_SOURCE_GROUP_NAME = '@@@data_source@@@'
export const AGENT_GROUP_NAME = '@@@agent@@@'

export function groupItems(
  items: ToolWithProvider[],
  getFirstChar: (item: ToolWithProvider) => string,
) {
  const groups = items.reduce<Record<string, Record<string, ToolWithProvider[]>>>((acc, item) => {
    const firstChar = getFirstChar(item)
    if (!firstChar) return acc

    const letter = /[\u4E00-\u9FA5]/.test(firstChar)
      ? pinyin(firstChar, { pattern: 'first', toneType: 'none' })[0]!.toUpperCase()
      : firstChar.toUpperCase()
    const normalizedLetter = /[A-Z]/.test(letter) ? letter : '#'
    const groupName = getGroupName(item)

    acc[normalizedLetter] ??= {}
    acc[normalizedLetter][groupName] ??= []
    acc[normalizedLetter][groupName].push(item)

    return acc
  }, {})

  const letters = Object.keys(groups).sort((left, right) => {
    if (left === '#') return 1
    if (right === '#') return -1
    return left.localeCompare(right)
  })
  return { letters, groups }
}

function getGroupName(item: ToolWithProvider) {
  if (item.type === CollectionType.builtIn) return item.author
  if (item.type === CollectionType.custom) return CUSTOM_GROUP_NAME
  if (item.type === CollectionType.workflow) return WORKFLOW_GROUP_NAME
  if (item.type === CollectionType.datasource) return DATA_SOURCE_GROUP_NAME
  return AGENT_GROUP_NAME
}
