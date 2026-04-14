import type { NotionPageRow, NotionPageSelectionMode, NotionPageTreeItem, NotionPageTreeMap } from './types'
import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'

export const recursivePushInParentDescendants = (
  pagesMap: DataSourceNotionPageMap,
  listTreeMap: NotionPageTreeMap,
  current: NotionPageTreeItem,
  leafItem: NotionPageTreeItem,
) => {
  const parentId = current.parent_id
  const pageId = current.page_id

  if (!parentId || !pageId)
    return

  if (parentId !== 'root' && pagesMap[parentId]) {
    if (!listTreeMap[parentId]) {
      const children = new Set([pageId])
      const descendants = new Set([pageId, leafItem.page_id])
      listTreeMap[parentId] = {
        ...pagesMap[parentId],
        children,
        descendants,
        depth: 0,
        ancestors: [],
      }
    }
    else {
      listTreeMap[parentId].children.add(pageId)
      listTreeMap[parentId].descendants.add(pageId)
      listTreeMap[parentId].descendants.add(leafItem.page_id)
    }

    leafItem.depth++
    leafItem.ancestors.unshift(listTreeMap[parentId].page_name)

    if (listTreeMap[parentId].parent_id !== 'root')
      recursivePushInParentDescendants(pagesMap, listTreeMap, listTreeMap[parentId], leafItem)
  }
}

export const buildNotionPageTree = (
  list: DataSourceNotionPage[],
  pagesMap: DataSourceNotionPageMap,
): NotionPageTreeMap => {
  return list.reduce((prev: NotionPageTreeMap, next) => {
    const pageId = next.page_id
    if (!prev[pageId])
      prev[pageId] = { ...next, children: new Set(), descendants: new Set(), depth: 0, ancestors: [] }

    recursivePushInParentDescendants(pagesMap, prev, prev[pageId], prev[pageId])
    return prev
  }, {})
}

export const getRootPageIds = (
  list: DataSourceNotionPage[],
  pagesMap: DataSourceNotionPageMap,
) => {
  return list
    .filter(item => item.parent_id === 'root' || !pagesMap[item.parent_id])
    .map(item => item.page_id)
}

export const getVisiblePageRows = ({
  list,
  pagesMap,
  searchValue,
  treeMap,
  rootPageIds,
  expandedIds,
}: {
  list: DataSourceNotionPage[]
  pagesMap: DataSourceNotionPageMap
  searchValue: string
  treeMap: NotionPageTreeMap
  rootPageIds: string[]
  expandedIds: Set<string>
}): NotionPageRow[] => {
  if (searchValue) {
    return list
      .filter(item => item.page_name.includes(searchValue))
      .map(item => ({
        page: item,
        parentExists: item.parent_id !== 'root' && Boolean(pagesMap[item.parent_id]),
        depth: treeMap[item.page_id]?.depth ?? 0,
        expand: false,
        hasChild: (treeMap[item.page_id]?.children.size ?? 0) > 0,
        ancestors: treeMap[item.page_id]?.ancestors ?? [],
      }))
  }

  const rows: NotionPageRow[] = []

  const visit = (pageId: string) => {
    const current = treeMap[pageId]
    if (!current)
      return

    const expand = expandedIds.has(pageId)
    rows.push({
      page: current,
      parentExists: current.parent_id !== 'root' && Boolean(pagesMap[current.parent_id]),
      depth: current.depth,
      expand,
      hasChild: current.children.size > 0,
      ancestors: current.ancestors,
    })

    if (!expand)
      return

    current.children.forEach(visit)
  }

  rootPageIds.forEach(visit)

  return rows
}

export const getNextSelectedPageIds = ({
  checkedIds,
  pageId,
  searchValue,
  selectionMode,
  treeMap,
}: {
  checkedIds: Set<string>
  pageId: string
  searchValue: string
  selectionMode: NotionPageSelectionMode
  treeMap: NotionPageTreeMap
}) => {
  const nextCheckedIds = new Set(checkedIds)
  const descendants = treeMap[pageId]?.descendants ?? new Set<string>()

  if (selectionMode === 'single') {
    if (nextCheckedIds.has(pageId)) {
      nextCheckedIds.delete(pageId)
    }
    else {
      nextCheckedIds.clear()
      nextCheckedIds.add(pageId)
    }

    return nextCheckedIds
  }

  if (nextCheckedIds.has(pageId)) {
    if (!searchValue)
      descendants.forEach(item => nextCheckedIds.delete(item))

    nextCheckedIds.delete(pageId)
    return nextCheckedIds
  }

  if (!searchValue)
    descendants.forEach(item => nextCheckedIds.add(item))

  nextCheckedIds.add(pageId)

  return nextCheckedIds
}
