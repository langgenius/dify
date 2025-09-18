import React from 'react'
import { useTranslation } from 'react-i18next'
import { areEqual } from 'react-window'
import type { ListChildComponentProps } from 'react-window'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import Checkbox from '@/app/components/base/checkbox'
import NotionIcon from '@/app/components/base/notion-icon'
import cn from '@/utils/classnames'
import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import Radio from '@/app/components/base/radio/ui'

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

const Item = ({ index, style, data }: ListChildComponentProps<{
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
  isMultipleChoice?: boolean
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
    isMultipleChoice,
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
      {isMultipleChoice ? (
        <Checkbox
          className='mr-2 shrink-0'
          checked={checkedIds.has(current.page_id)}
          disabled={disabled}
          onCheck={() => {
            handleCheck(index)
          }}
        />) : (
        <Radio
          className='mr-2 shrink-0'
          isChecked={checkedIds.has(current.page_id)}
          disabled={disabled}
          onCheck={() => {
            handleCheck(index)
          }}
        />
      )}
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

export default React.memo(Item, areEqual)
