import type { DataSourceNotionPage, DataSourceNotionPageMap } from '@/models/common'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import NotionIcon from '@/app/components/base/notion-icon'
import Radio from '@/app/components/base/radio/ui'
import { cn } from '@/utils/classnames'

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

type ItemProps = {
  virtualStart: number
  virtualSize: number
  current: NotionPageItem
  onToggle: (pageId: string) => void
  checkedIds: Set<string>
  disabledCheckedIds: Set<string>
  onCheck: (pageId: string) => void
  canPreview?: boolean
  onPreview: (pageId: string) => void
  listMapWithChildrenAndDescendants: NotionPageTreeMap
  searchValue: string
  previewPageId: string
  pagesMap: DataSourceNotionPageMap
  isMultipleChoice?: boolean
}

const Item = ({
  virtualStart,
  virtualSize,
  current,
  onToggle,
  checkedIds,
  disabledCheckedIds,
  onCheck,
  canPreview,
  onPreview,
  listMapWithChildrenAndDescendants,
  searchValue,
  previewPageId,
  pagesMap,
  isMultipleChoice,
}: ItemProps) => {
  const { t } = useTranslation()
  const currentWithChildrenAndDescendants = listMapWithChildrenAndDescendants[current.page_id]
  const hasChild = currentWithChildrenAndDescendants.descendants.size > 0
  const ancestors = currentWithChildrenAndDescendants.ancestors
  const breadCrumbs = ancestors.length ? [...ancestors, current.page_name] : [current.page_name]
  const disabled = disabledCheckedIds.has(current.page_id)

  const renderArrow = () => {
    if (hasChild) {
      return (
        <div
          className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-components-button-ghost-bg-hover"
          style={{ marginLeft: current.depth * 8 }}
          onClick={() => onToggle(current.page_id)}
        >
          {
            current.expand
              ? <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
              : <RiArrowRightSLine className="h-4 w-4 text-text-tertiary" />
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
      <div className="mr-1 h-5 w-5 shrink-0" style={{ marginLeft: current.depth * 8 }} />
    )
  }

  return (
    <div
      className={cn('group flex cursor-pointer items-center rounded-md pl-2 pr-[2px] hover:bg-state-base-hover', previewPageId === current.page_id && 'bg-state-base-hover')}
      style={{
        position: 'absolute',
        top: 0,
        left: 8,
        right: 8,
        width: 'calc(100% - 16px)',
        height: virtualSize,
        transform: `translateY(${virtualStart + 8}px)`,
      }}
    >
      {isMultipleChoice
        ? (
            <Checkbox
              className="mr-2 shrink-0"
              checked={checkedIds.has(current.page_id)}
              disabled={disabled}
              onCheck={() => onCheck(current.page_id)}
            />
          )
        : (
            <Radio
              className="mr-2 shrink-0"
              isChecked={checkedIds.has(current.page_id)}
              disabled={disabled}
              onCheck={() => onCheck(current.page_id)}
            />
          )}
      {!searchValue && renderArrow()}
      <NotionIcon
        className="mr-1 shrink-0"
        type="page"
        src={current.page_icon}
      />
      <div
        className="grow truncate text-[13px] font-medium leading-4 text-text-secondary"
        title={current.page_name}
      >
        {current.page_name}
      </div>
      {
        canPreview && (
          <div
            className="ml-1 hidden h-6 shrink-0 cursor-pointer items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 text-xs
            font-medium leading-4 text-components-button-secondary-text shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px]
            hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover group-hover:flex"
            onClick={() => onPreview(current.page_id)}
          >
            {t('dataSource.notion.selector.preview', { ns: 'common' })}
          </div>
        )
      }
      {
        searchValue && (
          <div
            className="ml-1 max-w-[120px] shrink-0 truncate text-xs text-text-quaternary"
            title={breadCrumbs.join(' / ')}
          >
            {breadCrumbs.join(' / ')}
          </div>
        )
      }
    </div>
  )
}

export default memo(Item)
