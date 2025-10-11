import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FixedSizeList as List, areEqual } from 'react-window'
import type { ListChildComponentProps } from 'react-window'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import Checkbox from '../../checkbox'
import NotionIcon from '../../notion-icon'
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
  depth: number
  ancestors: string[]
} & DataSourceNotionPage
type NotionPageTreeMap = Record<string, NotionPageTreeItem>
type NotionPageItem = {
  expand: boolean
  depth: number
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
  const {
    dataList,
    handleToggle,
    checkedIds,
    disabledCheckedIds,
    handleCheck,
    canPreview,
    handlePreview,
    listMapWithChildrenAndDescendants,
    searchValue,
    previewPageId,
    pagesMap,
  } = data
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
          className='mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-components-button-ghost-bg-hover'
          style={{ marginLeft: current.depth * 8 }}
          onClick={() => handleToggle(index)}
        >
          {
            current.expand
              ? <RiArrowDownSLine className='h-4 w-4 text-text-tertiary' />
              : <RiArrowRightSLine className='h-4 w-4 text-text-tertiary' />
          }
        </div>
      )
    }
    if (current.parent_id === 'root' || !pagesMap[current.parent_id]) {
      return (
        <div></div>
      )
    }
    return (
      <div className='mr-1 h-5 w-5 shrink-0' style={{ marginLeft: current.depth * 8 }} />
    )
  }

  return (
    <div
      className={cn('group flex cursor-pointer items-center rounded-md pl-2 pr-[2px] hover:bg-state-base-hover',
        previewPageId === current.page_id && 'bg-state-base-hover')}
      style={{ ...style, top: style.top as number + 8, left: 8, right: 8, width: 'calc(100% - 16px)' }}
    >
      <Checkbox
        className='mr-2 shrink-0'
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
        className='mr-1 shrink-0'
        type='page'
        src={current.page_icon}
      />
      <div
        className='grow truncate text-[13px] font-medium leading-4 text-text-secondary'
        title={current.page_name}
      >
        {current.page_name}
      </div>
      {
        canPreview && (
          <div
            className='ml-1 hidden h-6 shrink-0 cursor-pointer items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 text-xs
            font-medium leading-4 text-components-button-secondary-text shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px]
            hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover group-hover:flex'
            onClick={() => handlePreview(index)}>
            {t('common.dataSource.notion.selector.preview')}
          </div>
        )
      }
      {
        searchValue && (
          <div
            className='ml-1 max-w-[120px] shrink-0 truncate text-xs text-text-quaternary'
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
  const [dataList, setDataList] = useState<NotionPageItem[]>([])
  const [localPreviewPageId, setLocalPreviewPageId] = useState('')

  useEffect(() => {
    setDataList(list.filter(item => item.parent_id === 'root' || !pagesMap[item.parent_id]).map((item) => {
      return {
        ...item,
        expand: false,
        depth: 0,
      }
    }))
  }, [list])

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

      newDataList = dataList.filter(item => !descendantsIds.includes(item.page_id))
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

  const copyValue = new Set(value)
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

    onSelect(new Set(copyValue))
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
