import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FixedSizeList as List, areEqual } from 'react-window'
import type { ListChildComponentProps } from 'react-window'
import cn from 'classnames'
import Checkbox from '../../checkbox'
import NotionIcon from '../../notion-icon'
import s from './index.module.css'
import type { DataSourceNotionPage } from '@/models/common'

type PageSelectorProps = {
  value?: string[]
  searchValue: string
  list: DataSourceNotionPage[]
  onSelect: (selectedPages: DataSourceNotionPage[]) => void
  canPreview?: boolean
  onPreview?: (selectedPage: DataSourceNotionPage) => void
}
type NotionPageMap = Record<string, DataSourceNotionPage>
type NotionPageTreeItem = {
  children: Set<string>
  descendants: Set<string>
  deepth: number
  ancestors: string[]
} & DataSourceNotionPage
type NotionPageTreeMap = Record<string, NotionPageTreeItem>
type NotionPageItem = {
  expand: boolean
  deepth: number
} & DataSourceNotionPage

const recursivePushInParentDescendants = (
  listMap: Record<string, DataSourceNotionPage>,
  listTreeMap: NotionPageTreeMap,
  current: NotionPageTreeItem,
  leafItem: NotionPageTreeItem,
) => {
  const parentId = current.parent_id
  const pageId = current.page_id

  if (parentId !== 'root') {
    if (!listTreeMap[parentId]) {
      const children = new Set([pageId])
      const descendants = new Set([pageId, leafItem.page_id])

      listTreeMap[parentId] = {
        ...listMap[parentId],
        children,
        descendants,
        deepth: 0,
        ancestors: [],
      }
    }
    else {
      listTreeMap[parentId].children.add(pageId)
      listTreeMap[parentId].descendants.add(pageId)
      listTreeMap[parentId].descendants.add(leafItem.page_id)
    }
    leafItem.deepth++
    leafItem.ancestors.unshift(listTreeMap[parentId].page_name)

    if (listTreeMap[parentId].parent_id !== 'root')
      recursivePushInParentDescendants(listMap, listTreeMap, listTreeMap[parentId], leafItem)
  }
}

const Item = memo(({ index, style, data }: ListChildComponentProps<{
  dataList: NotionPageItem[]
  handleToggle: (index: number) => void
  checkedIds: Set<string>
  handleCheck: (index: number) => void
  canPreview?: boolean
  handlePreview: (index: number) => void
  listMapWithChildrenAndDescendants: NotionPageTreeMap
  searchValue: string
}>) => {
  const { t } = useTranslation()
  const { dataList, handleToggle, checkedIds, handleCheck, canPreview, handlePreview, listMapWithChildrenAndDescendants, searchValue } = data
  const current = dataList[index]
  const currentWithChildrenAndDescendants = listMapWithChildrenAndDescendants[current.page_id]
  const hasChild = currentWithChildrenAndDescendants.descendants.size > 0
  const ancestors = currentWithChildrenAndDescendants.ancestors
  const breadCrumbs = ancestors.length ? [...ancestors, current.page_name] : [current.page_name]
  let iconSrc

  if (current.page_icon && current.page_icon.type === 'url')
    iconSrc = current.page_icon.url

  if (current.page_icon && current.page_icon.type === 'emoji')
    iconSrc = current.page_icon.emoji

  const renderArrow = () => {
    return hasChild
      ? (
        <div
          className={cn(s.arrow, current.expand && s['arrow-expand'], 'shrink-0 mr-1 w-5 h-5 hover:bg-gray-200 rounded-md')}
          style={{ marginLeft: current.deepth * 8 }}
          onClick={() => handleToggle(index)}
        />
      )
      : (
        <div className='shrink-0 mr-1 w-5 h-5' style={{ marginLeft: current.deepth * 8 }} />
      )
  }

  return (
    <div
      className='group flex items-center pl-2 pr-[2px] rounded-md hover:bg-gray-100 cursor-pointer'
      style={{ ...style, top: style.top as number + 8, left: 8, right: 8, width: 'calc(100% - 16px)' }}
    >
      <Checkbox
        className='shrink-0 mr-2 group-hover:border-primary-600 group-hover:border-[2px]'
        checked={checkedIds.has(current.page_id)}
        onCheck={() => handleCheck(index)}
      />
      {!searchValue && renderArrow()}
      <NotionIcon
        className='shrink-0 mr-1'
        type='page'
        src={iconSrc}
      />
      <div
        className='grow text-sm font-medium text-gray-700 truncate'
        title={current.page_name}
      >
        {current.page_name}
      </div>
      {
        canPreview && (
          <div
            className='shrink-0 hidden group-hover:flex items-center ml-1 px-2 h-6 rounded-md text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-50'
            onClick={() => handlePreview(index)}>
            {t('common.dataSource.notion.selector.preview')}
          </div>
        )
      }
      {
        searchValue && (
          <div
            className='shrink-0 ml-1 max-w-[120px] text-xs text-gray-400 truncate'
            title={breadCrumbs.join(' / ')}
          >
            {breadCrumbs.join(' / ')}
          </div>
        )
      }
    </div>
  )
}, areEqual)

const PageSelector = ({
  value,
  searchValue,
  list,
  onSelect,
  canPreview = true,
  onPreview,
}: PageSelectorProps) => {
  const [dataList, setDataList] = useState<NotionPageItem[]>(
    list.filter(item => item.parent_id === 'root').map((item) => {
      return {
        ...item,
        expand: false,
        deepth: 0,
      }
    }),
  )
  const [searchDataList, setSearchDataList] = useState<NotionPageItem[]>([])
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set(value || []))
  const listMap = list.reduce((prev: NotionPageMap, next: DataSourceNotionPage) => {
    prev[next.page_id] = next

    return prev
  }, {})
  const listMapWithChildrenAndDescendants = list.reduce((prev: NotionPageTreeMap, next: DataSourceNotionPage) => {
    const pageId = next.page_id
    if (!prev[pageId])
      prev[pageId] = { ...next, children: new Set(), descendants: new Set(), deepth: 0, ancestors: [] }

    recursivePushInParentDescendants(listMap, prev, prev[pageId], prev[pageId])
    return prev
  }, {})

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
          ...listMap[item],
          expand: false,
          deepth: listMapWithChildrenAndDescendants[item].deepth,
        })),
        ...dataList.slice(index + 1)]
    }
    setDataList(newDataList)
  }

  const handleCheck = (index: number) => {
    const current = searchValue ? searchDataList[index] : dataList[index]
    const pageId = current.page_id
    const currentWithChildrenAndDescendants = listMapWithChildrenAndDescendants[pageId]

    if (checkedIds.has(pageId)) {
      if (!searchValue) {
        for (const item of currentWithChildrenAndDescendants.descendants)
          checkedIds.delete(item)
      }

      checkedIds.delete(pageId)
    }
    else {
      if (!searchValue) {
        for (const item of currentWithChildrenAndDescendants.descendants)
          checkedIds.add(item)
      }

      checkedIds.add(pageId)
    }

    setCheckedIds(new Set([...checkedIds]))
    onSelect([...checkedIds].map(item => listMap[item]))
  }

  const handlePreview = (index: number) => {
    if (onPreview) {
      const current = dataList[index]
      const pageId = current.page_id
      onPreview(listMap[pageId])
    }
  }

  useEffect(() => {
    setSearchDataList(list.filter((item) => {
      return item.page_name.includes(searchValue)
    }).map((item) => {
      return {
        ...item,
        expand: false,
        deepth: 0,
      }
    }))
  }, [searchValue])

  return (
    <List
      className='py-2'
      height={296}
      itemCount={searchValue ? searchDataList.length : dataList.length}
      itemSize={28}
      width='100%'
      itemKey={(index, data) => data.dataList[index].page_id}
      itemData={{
        dataList: searchValue ? searchDataList : dataList,
        handleToggle,
        checkedIds,
        handleCheck,
        canPreview,
        handlePreview,
        listMapWithChildrenAndDescendants,
        searchValue,
      }}
    >
      {Item}
    </List>
  )
}

export default PageSelector
