import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FixedSizeList as List, areEqual } from 'react-window'
import type { ListChildComponentProps } from 'react-window'
import Checkbox from '../../checkbox'
import NotionIcon from '../../notion-icon'
import s from './index.module.css'
import cn from '@/utils/classnames'
import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'

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
      recursivePushInParentDescendants(pagesMap, listTreeMap, listTreeMap[parentId], leafItem)
  }
}

const ItemComponent = ({ index, style, data }: ListChildComponentProps<{
  dataList: NotionPageItem[]
  handleToggle: (index: number) => void
  checkedIds: Set<string>
  disabledCheckedIds: Set<string>
  handleCheck: (index: number) => void
  canPreview?: boolean
  handlePreview: (index: number) => void
  listMapWithChildrenAndDescendants: NotionPageTreeMap
  searchValue: string
  previewPageId: string
  pagesMap: DataSourceNotionPageMap
}>) => {
  const { t } = useTranslation()
  const { dataList, handleToggle, checkedIds, disabledCheckedIds, handleCheck, canPreview, handlePreview, listMapWithChildrenAndDescendants, searchValue, previewPageId, pagesMap } = data
  const current = dataList[index]
  const currentWithChildrenAndDescendants = listMapWithChildrenAndDescendants[current.page_id]
  const hasChild = currentWithChildrenAndDescendants.descendants.size > 0
  const ancestors = currentWithChildrenAndDescendants.ancestors
  const breadCrumbs = ancestors.length ? [...ancestors, current.page_name] : [current.page_name]
  const disabled = disabledCheckedIds.has(current.page_id)

  const renderArrow = () => {
    if (hasChild) {
      return (
        <div
          className={cn(s.arrow, current.expand && s['arrow-expand'], 'shrink-0 mr-1 w-5 h-5 hover:bg-gray-200 rounded-md')}
          style={{ marginLeft: current.deepth * 8 }}
          onClick={() => handleToggle(index)}
        />
      )
    }
    if (current.parent_id === 'root' || !pagesMap[current.parent_id]) {
      return (
        <div></div>
      )
    }
    return (
      <div className='shrink-0 mr-1 w-5 h-5' style={{ marginLeft: current.deepth * 8 }} />
    )
  }

  return (
    <div
      className={cn('group flex items-center pl-2 pr-[2px] rounded-md border border-transparent hover:bg-gray-100 cursor-pointer', previewPageId === current.page_id && s['preview-item'])}
      style={{ ...style, top: style.top as number + 8, left: 8, right: 8, width: 'calc(100% - 16px)' }}
    >
      <Checkbox
        className={cn(
          'shrink-0 mr-2 group-hover:border-primary-600 group-hover:border-[2px]',
          disabled && 'group-hover:border-transparent',
        )}
        checked={checkedIds.has(current.page_id)}
        disabled={disabled}
        onCheck={() => {
          if (disabled)
            return
          handleCheck(index)
        }}
      />
      {!searchValue && renderArrow()}
      <NotionIcon
        className='shrink-0 mr-1'
        type='page'
        src={current.page_icon}
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
            className='shrink-0 hidden group-hover:flex items-center ml-1 px-2 h-6 rounded-md text-xs font-medium text-gray-500 cursor-pointer hover:bg-gray-50 hover:text-gray-700'
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
}
const Item = memo(ItemComponent, areEqual)

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
        deepth: 0,
      }
    }))
  }
  const searchDataList = list.filter((item) => {
    return item.page_name.includes(searchValue)
  }).map((item) => {
    return {
      ...item,
      expand: false,
      deepth: 0,
    }
  })
  const currentDataList = searchValue ? searchDataList : dataList
  const currentPreviewPageId = previewPageId === undefined ? localPreviewPageId : previewPageId

  const listMapWithChildrenAndDescendants = useMemo(() => {
    return list.reduce((prev: NotionPageTreeMap, next: DataSourceNotionPage) => {
      const pageId = next.page_id
      if (!prev[pageId])
        prev[pageId] = { ...next, children: new Set(), descendants: new Set(), deepth: 0, ancestors: [] }

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
          deepth: listMapWithChildrenAndDescendants[item].deepth,
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
      <div className='flex items-center justify-center h-[296px] text-[13px] text-gray-500'>
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
