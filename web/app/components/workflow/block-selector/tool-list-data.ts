import type { ToolWithProvider } from '../types'
import { pinyin } from 'pinyin-pro'
import { CollectionType } from '../../tools/types'

type ToolCategoryGroup = 'custom' | 'data-source' | 'mcp' | 'workflow'

type AuthorToolGroup = {
  kind: 'author'
  author: string
  tools: ToolWithProvider[]
}

type CategoryToolGroup = {
  kind: 'category'
  category: ToolCategoryGroup
  tools: ToolWithProvider[]
}

export type ToolGroup = AuthorToolGroup | CategoryToolGroup

type ToolListData = {
  letters: string[]
  flatTools: Array<ToolWithProvider & { letter: string }>
  treeGroups: ToolGroup[]
}

type LetterBucket = {
  groups: ToolGroup[]
  authorGroups: Map<string, AuthorToolGroup>
  categoryGroups: Map<ToolCategoryGroup, CategoryToolGroup>
}

export function createToolListData(
  tools: readonly ToolWithProvider[],
  getFirstChar: (tool: ToolWithProvider) => string,
): ToolListData {
  const buckets = new Map<string, LetterBucket>()

  for (const tool of tools) {
    const firstChar = getFirstChar(tool)
    if (!firstChar) continue

    const letter = normalizeLetter(firstChar)
    const bucket = getOrCreateBucket(buckets, letter)
    addToolToBucket(bucket, tool)
  }

  const sortedBuckets = [...buckets.entries()].sort(([left], [right]) => {
    if (left === '#') return 1
    if (right === '#') return -1
    return left.localeCompare(right)
  })
  const letters = sortedBuckets.map(([letter]) => letter)
  const flatTools = sortedBuckets.flatMap(([letter, bucket]) =>
    bucket.groups.flatMap((group) => group.tools.map((tool) => ({ ...tool, letter }))),
  )
  const treeGroups = mergeGroupsByProvider(sortedBuckets.map(([, bucket]) => bucket))

  return { letters, flatTools, treeGroups }
}

function normalizeLetter(firstChar: string) {
  const pinyinInitial = /[\u4E00-\u9FA5]/.test(firstChar)
    ? pinyin(firstChar, { pattern: 'first', toneType: 'none' })[0]
    : firstChar
  const letter = (pinyinInitial || firstChar).toUpperCase()

  return /[A-Z]/.test(letter) ? letter : '#'
}

function getOrCreateBucket(buckets: Map<string, LetterBucket>, letter: string) {
  const existingBucket = buckets.get(letter)
  if (existingBucket) return existingBucket

  const bucket: LetterBucket = {
    groups: [],
    authorGroups: new Map(),
    categoryGroups: new Map(),
  }
  buckets.set(letter, bucket)
  return bucket
}

function addToolToBucket(bucket: LetterBucket, tool: ToolWithProvider) {
  const category = getToolCategoryGroup(tool.type)
  if (!category) {
    addToolToAuthorGroup(bucket, tool)
    return
  }

  const existingGroup = bucket.categoryGroups.get(category)
  if (existingGroup) {
    existingGroup.tools.push(tool)
    return
  }

  const group: CategoryToolGroup = { kind: 'category', category, tools: [tool] }
  bucket.categoryGroups.set(category, group)
  bucket.groups.push(group)
}

function addToolToAuthorGroup(bucket: LetterBucket, tool: ToolWithProvider) {
  const existingGroup = bucket.authorGroups.get(tool.author)
  if (existingGroup) {
    existingGroup.tools.push(tool)
    return
  }

  const group: AuthorToolGroup = { kind: 'author', author: tool.author, tools: [tool] }
  bucket.authorGroups.set(tool.author, group)
  bucket.groups.push(group)
}

function getToolCategoryGroup(type: ToolWithProvider['type']): ToolCategoryGroup | undefined {
  if (type === CollectionType.custom) return 'custom'
  if (type === CollectionType.workflow) return 'workflow'
  if (type === CollectionType.datasource) return 'data-source'
  if (type === CollectionType.mcp) return 'mcp'
}

function mergeGroupsByProvider(buckets: LetterBucket[]) {
  const groups: ToolGroup[] = []
  const authorGroups = new Map<string, AuthorToolGroup>()
  const categoryGroups = new Map<ToolCategoryGroup, CategoryToolGroup>()

  for (const bucket of buckets) {
    for (const group of bucket.groups) {
      if (group.kind === 'author') {
        const existingGroup = authorGroups.get(group.author)
        if (existingGroup) existingGroup.tools.push(...group.tools)
        else {
          const mergedGroup: AuthorToolGroup = { ...group, tools: [...group.tools] }
          authorGroups.set(group.author, mergedGroup)
          groups.push(mergedGroup)
        }
        continue
      }

      const existingGroup = categoryGroups.get(group.category)
      if (existingGroup) existingGroup.tools.push(...group.tools)
      else {
        const mergedGroup: CategoryToolGroup = { ...group, tools: [...group.tools] }
        categoryGroups.set(group.category, mergedGroup)
        groups.push(mergedGroup)
      }
    }
  }

  return groups
}
