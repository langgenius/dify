import type { FC } from 'react'
import type { ChildChunkDetail } from '@/models/datasets'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import Input from '@/app/components/base/input'
import { cn } from '@/utils/classnames'
import { formatNumber } from '@/utils/format'
import { EditSlice } from '../../../formatted-text/flavours/edit-slice'
import { FormattedText } from '../../../formatted-text/formatted'
import { useDocumentContext } from '../context'
import Empty from './common/empty'
import { useSegmentListContext } from './index'
import FullDocListSkeleton from './skeleton/full-doc-list-skeleton'

type IChildSegmentCardProps = {
  childChunks: ChildChunkDetail[]
  parentChunkId: string
  handleInputChange?: (value: string) => void
  handleAddNewChildChunk?: (parentChunkId: string) => void
  enabled: boolean
  onDelete?: (segId: string, childChunkId: string) => Promise<void>
  onClickSlice?: (childChunk: ChildChunkDetail) => void
  total?: number
  inputValue?: string
  onClearFilter?: () => void
  isLoading?: boolean
  focused?: boolean
}

function computeTotalInfo(
  isFullDocMode: boolean,
  isSearching: boolean,
  total: number | undefined,
  childChunksLength: number,
): { displayText: string, count: number, translationKey: 'segment.searchResults' | 'segment.childChunks' } {
  if (isSearching) {
    const count = total ?? 0
    return {
      displayText: count === 0 ? '--' : String(formatNumber(count)),
      count,
      translationKey: 'segment.searchResults',
    }
  }

  if (isFullDocMode) {
    const count = total ?? 0
    return {
      displayText: count === 0 ? '--' : String(formatNumber(count)),
      count,
      translationKey: 'segment.childChunks',
    }
  }

  return {
    displayText: String(formatNumber(childChunksLength)),
    count: childChunksLength,
    translationKey: 'segment.childChunks',
  }
}

const ChildSegmentList: FC<IChildSegmentCardProps> = ({
  childChunks,
  parentChunkId,
  handleInputChange,
  handleAddNewChildChunk,
  enabled,
  onDelete,
  onClickSlice,
  total,
  inputValue,
  onClearFilter,
  isLoading,
  focused = false,
}) => {
  const { t } = useTranslation()
  const parentMode = useDocumentContext(s => s.parentMode)
  const currChildChunk = useSegmentListContext(s => s.currChildChunk)

  const [collapsed, setCollapsed] = useState(true)

  const isParagraphMode = parentMode === 'paragraph'
  const isFullDocMode = parentMode === 'full-doc'
  const isSearching = inputValue !== '' && isFullDocMode
  const contentOpacity = (enabled || focused) ? '' : 'opacity-50 group-hover/card:opacity-100'
  const { displayText, count, translationKey } = computeTotalInfo(isFullDocMode, isSearching, total, childChunks.length)
  const totalText = `${displayText} ${t(translationKey, { ns: 'datasetDocuments', count })}`

  const toggleCollapse = () => setCollapsed(prev => !prev)
  const showContent = (isFullDocMode && !isLoading) || !collapsed
  const hoverVisibleClass = isParagraphMode ? 'hidden group-hover/card:inline-block' : ''

  const renderCollapseIcon = () => {
    if (!isParagraphMode)
      return null
    const Icon = collapsed ? RiArrowRightSLine : RiArrowDownSLine
    return <Icon className={cn('mr-0.5 h-4 w-4 text-text-secondary', collapsed && 'opacity-50')} />
  }

  const renderChildChunkItem = (childChunk: ChildChunkDetail) => {
    const isEdited = childChunk.updated_at !== childChunk.created_at
    const isFocused = currChildChunk?.childChunkInfo?.id === childChunk.id
    const label = isEdited
      ? `C-${childChunk.position} · ${t('segment.edited', { ns: 'datasetDocuments' })}`
      : `C-${childChunk.position}`

    return (
      <EditSlice
        key={childChunk.id}
        label={label}
        text={childChunk.content}
        onDelete={() => onDelete?.(childChunk.segment_id, childChunk.id)}
        className="child-chunk"
        labelClassName={isFocused ? 'bg-state-accent-solid text-text-primary-on-surface' : ''}
        labelInnerClassName="text-[10px] font-semibold align-bottom leading-6"
        contentClassName={cn('!leading-6', isFocused ? 'bg-state-accent-hover-alt text-text-primary' : 'text-text-secondary')}
        showDivider={false}
        onClick={(e) => {
          e.stopPropagation()
          onClickSlice?.(childChunk)
        }}
        offsetOptions={({ rects }) => ({
          mainAxis: isFullDocMode ? -rects.floating.width : 12 - rects.floating.width,
          crossAxis: (20 - rects.floating.height) / 2,
        })}
      />
    )
  }

  const renderContent = () => {
    if (childChunks.length > 0) {
      return (
        <FormattedText className={cn('flex w-full flex-col !leading-6', isParagraphMode ? 'gap-y-2' : 'gap-y-3')}>
          {childChunks.map(renderChildChunkItem)}
        </FormattedText>
      )
    }
    if (inputValue !== '') {
      return (
        <div className="h-full w-full">
          <Empty onClearFilter={onClearFilter!} />
        </div>
      )
    }
    return null
  }

  return (
    <div className={cn(
      'flex flex-col',
      contentOpacity,
      isParagraphMode ? 'pb-2 pt-1' : 'grow px-3',
      isFullDocMode && isLoading && 'overflow-y-hidden',
    )}
    >
      {isFullDocMode && <Divider type="horizontal" className="my-1 h-px bg-divider-subtle" />}
      <div className={cn('flex items-center justify-between', isFullDocMode && 'sticky -top-2 left-0 bg-background-default pb-3 pt-2')}>
        <div
          className={cn(
            'flex h-7 items-center rounded-lg pl-1 pr-3',
            isParagraphMode && 'cursor-pointer',
            isParagraphMode && collapsed && 'bg-dataset-child-chunk-expand-btn-bg',
            isFullDocMode && 'pl-0',
          )}
          onClick={(event) => {
            event.stopPropagation()
            toggleCollapse()
          }}
        >
          {renderCollapseIcon()}
          <span className="system-sm-semibold-uppercase text-text-secondary">{totalText}</span>
          <span className={cn('pl-1.5 text-xs font-medium text-text-quaternary', hoverVisibleClass)}>·</span>
          <button
            type="button"
            className={cn(
              'system-xs-semibold-uppercase px-1.5 py-1 text-components-button-secondary-accent-text',
              hoverVisibleClass,
              isFullDocMode && isLoading && 'text-components-button-secondary-accent-text-disabled',
            )}
            onClick={(event) => {
              event.stopPropagation()
              handleAddNewChildChunk?.(parentChunkId)
            }}
            disabled={isLoading}
          >
            {t('operation.add', { ns: 'common' })}
          </button>
        </div>
        {isFullDocMode && (
          <Input
            showLeftIcon
            showClearIcon
            wrapperClassName="!w-52"
            value={inputValue}
            onChange={e => handleInputChange?.(e.target.value)}
            onClear={() => handleInputChange?.('')}
          />
        )}
      </div>
      {isLoading && <FullDocListSkeleton />}
      {showContent && (
        <div className={cn('flex gap-x-0.5', isFullDocMode ? 'mb-6 grow' : 'items-center')}>
          {isParagraphMode && (
            <div className="self-stretch">
              <Divider type="vertical" className="mx-[7px] w-[2px] bg-text-accent-secondary" />
            </div>
          )}
          {renderContent()}
        </div>
      )}
    </div>
  )
}

export default ChildSegmentList
