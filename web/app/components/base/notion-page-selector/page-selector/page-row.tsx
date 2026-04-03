import type { CSSProperties } from 'react'
import type { NotionPageRow as NotionPageRowData, NotionPageSelectionMode } from './types'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Checkbox from '@/app/components/base/checkbox'
import NotionIcon from '@/app/components/base/notion-icon'
import Radio from '@/app/components/base/radio/ui'
import { cn } from '@/utils/classnames'

type NotionPageRowProps = {
  checked: boolean
  disabled: boolean
  isPreviewed: boolean
  onPreview: (pageId: string) => void
  onSelect: (pageId: string) => void
  onToggle: (pageId: string) => void
  row: NotionPageRowData
  searchValue: string
  selectionMode: NotionPageSelectionMode
  showPreview: boolean
  style: CSSProperties
}

const NotionPageRow = ({
  checked,
  disabled,
  isPreviewed,
  onPreview,
  onSelect,
  onToggle,
  row,
  searchValue,
  selectionMode,
  showPreview,
  style,
}: NotionPageRowProps) => {
  const { t } = useTranslation()
  const pageId = row.page.page_id
  const breadcrumbs = row.ancestors.length ? [...row.ancestors, row.page.page_name] : [row.page.page_name]

  return (
    <div
      className={cn('group flex cursor-pointer items-center rounded-md pl-2 pr-[2px] hover:bg-state-base-hover', isPreviewed && 'bg-state-base-hover')}
      style={style}
      data-testid={`notion-page-row-${pageId}`}
    >
      {selectionMode === 'multiple'
        ? (
            <Checkbox
              className="mr-2 shrink-0"
              checked={checked}
              disabled={disabled}
              onCheck={() => onSelect(pageId)}
              id={`notion-page-checkbox-${pageId}`}
            />
          )
        : (
            <Radio
              className="mr-2 shrink-0"
              isChecked={checked}
              disabled={disabled}
              onCheck={() => onSelect(pageId)}
            />
          )}
      {!searchValue && row.hasChild && (
        <div
          className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-components-button-ghost-bg-hover"
          style={{ marginLeft: row.depth * 8 }}
          onClick={() => onToggle(pageId)}
          data-testid={`notion-page-toggle-${pageId}`}
        >
          {row.expand
            ? <RiArrowDownSLine className="h-4 w-4 text-text-tertiary" />
            : <RiArrowRightSLine className="h-4 w-4 text-text-tertiary" />}
        </div>
      )}
      {!searchValue && !row.hasChild && row.parentExists && (
        <div className="mr-1 h-5 w-5 shrink-0" style={{ marginLeft: row.depth * 8 }} />
      )}
      <NotionIcon
        className="mr-1 shrink-0"
        type="page"
        src={row.page.page_icon}
      />
      <div
        className="grow truncate text-[13px] font-medium leading-4 text-text-secondary"
        title={row.page.page_name}
        data-testid={`notion-page-name-${pageId}`}
      >
        {row.page.page_name}
      </div>
      {showPreview && (
        <div
          className="ml-1 hidden h-6 shrink-0 cursor-pointer items-center rounded-md border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-2 text-xs
          font-medium leading-4 text-components-button-secondary-text shadow-xs shadow-shadow-shadow-3 backdrop-blur-[10px]
          hover:border-components-button-secondary-border-hover hover:bg-components-button-secondary-bg-hover group-hover:flex"
          onClick={() => onPreview(pageId)}
          data-testid={`notion-page-preview-${pageId}`}
        >
          {t('dataSource.notion.selector.preview', { ns: 'common' })}
        </div>
      )}
      {searchValue && (
        <div
          className="ml-1 max-w-[120px] shrink-0 truncate text-xs text-text-quaternary"
          title={breadcrumbs.join(' / ')}
        >
          {breadcrumbs.join(' / ')}
        </div>
      )}
    </div>
  )
}

export default memo(NotionPageRow)
