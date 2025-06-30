import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FixedSizeList as List } from 'react-window'
import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import Item from './item'
import { recursivePushInParentDescendants } from './utils'

type PageSelectorProps = {
  value: Set<string>
  disabledValue: Set<string>
  searchValue: string
  pagesMap: DataSourceNotionPageMap
  list: DataSourceNotionPage[]
  onSelect: (selectedPagesId: Set<string>) => void
  canPreview?: boolean
  previewPageId?: string
  onPreview?: (selectedPageId: string) => void
}

export type NotionPageTreeItem = {
  children: Set<string>
  descendants: Set<string>
  depth: number
  ancestors: string[]
} & DataSourceNotionPage

export type NotionPageTreeMap = Record<string, NotionPageTreeItem>

type NotionPageItem = {
  expand: boolean
  depth: number
} & DataSourceNotionPage

const PageSelector = ({
  value,
  disabledValue,
  searchValue,
  pagesMap,
  list,
  onSelect,
  canPreview = true,
  previewPageId,
  onPreview,
}: PageSelectorProps) => {
  const { t } = useTranslation()
  const [prevDataList, setPrevDataList] = useState(list)
  const [dataList, setDataList] = useState<NotionPageItem[]>([])
  const [localPreviewPageId, setLocalPreviewPageId] = useState('')
  if (prevDataList !== list) {
    setPrevDataList(list)
    setDataList(list.filter(item => item.parent_id === 'root' || !pagesMap[item.parent_id]).map((item) => {
      return {
        ...item,
        expand: false,
        depth: 0,
      }
    }))
  }
  const searchDataList = list.filter((item) => {
    return item.page_name.includes(searchValue)
  }).map((item) => {
    return {
      ...item,
      expand: false,
      depth: 0,
    }
  })
  const currentDataList = searchValue ? searchDataList : dataList
  const currentPreviewPageId = previewPageId === undefined ? localPreviewPageId : previewPageId

  const listMapWithChildrenAndDescendants = useMemo(() => {
    return list.reduce((prev: NotionPageTreeMap, next: DataSourceNotionPage) => {
      const pageId = next.page_id
      if (!prev[pageId])
        prev[pageId] = { ...next, children: new Set(), descendants: new Set(), depth: 0, ancestors: [] }

      recursivePushInParentDescendants(pagesMap, prev, prev[pageId], prev[pageId])
      return prev
    }, {})
  }, [list, pagesMap])

  const handleToggle = (index: number) => {
    const current = dataList[index]
    const pageId = current.page_id
    const currentWithChildrenAndDescendants = listMapWithChildrenAndDescendants[pageId]
    const descendantsIds = Array.from(currentWithChildrenAndDescendants.descendants)
    const childrenIds = Array.from(currentWithChildrenAndDescendants.children)
    let newDataList = []

    if (current.expand) {
      current.expand = false

      newDataList = [...dataList.filter(item => !descendantsIds.includes(item.page_id))]
    }
    else {
      current.expand = true

      newDataList = [
        ...dataList.slice(0, index + 1),
        ...childrenIds.map(item => ({
          ...pagesMap[item],
          expand: false,
          depth: listMapWithChildrenAndDescendants[item].depth,
        })),
        ...dataList.slice(index + 1)]
    }
    setDataList(newDataList)
  }

  const copyValue = new Set([...value])
  const handleCheck = (index: number) => {
    const current = currentDataList[index]
    const pageId = current.page_id
    const currentWithChildrenAndDescendants = listMapWithChildrenAndDescendants[pageId]

    if (copyValue.has(pageId)) {
      if (!searchValue) {
        for (const item of currentWithChildrenAndDescendants.descendants)
          copyValue.delete(item)
      }

      copyValue.delete(pageId)
    }
    else {
      if (!searchValue) {
        for (const item of currentWithChildrenAndDescendants.descendants)
          copyValue.add(item)
      }

      copyValue.add(pageId)
    }

    onSelect(new Set([...copyValue]))
  }

  const handlePreview = (index: number) => {
    const current = currentDataList[index]
    const pageId = current.page_id

    setLocalPreviewPageId(pageId)

    if (onPreview)
      onPreview(pageId)
  }

  if (!currentDataList.length) {
    return (
      <div className='flex h-[296px] items-center justify-center text-[13px] text-text-tertiary'>
        {t('common.dataSource.notion.selector.noSearchResult')}
      </div>
    )
  }

  return (
    <List
      className='py-2'
      height={296}
      itemCount={currentDataList.length}
      itemSize={28}
      width='100%'
      itemKey={(index, data) => data.dataList[index].page_id}
      itemData={{
        dataList: currentDataList,
        handleToggle,
        checkedIds: value,
        disabledCheckedIds: disabledValue,
        handleCheck,
        canPreview,
        handlePreview,
        listMapWithChildrenAndDescendants,
        searchValue,
        previewPageId: currentPreviewPageId,
        pagesMap,
      }}
    >
      {Item}
    </List>
  )
}

export default PageSelector
