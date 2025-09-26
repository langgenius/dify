import type { DataSourceNotionPageMap } from '@/models/common'
import type { NotionPageTreeItem, NotionPageTreeMap } from './index'

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
