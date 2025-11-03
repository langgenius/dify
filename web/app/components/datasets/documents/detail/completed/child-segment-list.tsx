import { type FC, useMemo, useState } from 'react'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { EditSlice } from '../../../formatted-text/flavours/edit-slice'
import { useDocumentContext } from '../context'
import { FormattedText } from '../../../formatted-text/formatted'
import Empty from './common/empty'
import FullDocListSkeleton from './skeleton/full-doc-list-skeleton'
import { useSegmentListContext } from './index'
import type { ChildChunkDetail } from '@/models/datasets'
import Input from '@/app/components/base/input'
import cn from '@/utils/classnames'
import Divider from '@/app/components/base/divider'
import { formatNumber } from '@/utils/format'

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

  const toggleCollapse = () => {
    setCollapsed(!collapsed)
  }

  const isParagraphMode = useMemo(() => {
    return parentMode === 'paragraph'
  }, [parentMode])

  const isFullDocMode = useMemo(() => {
    return parentMode === 'full-doc'
  }, [parentMode])

  const contentOpacity = useMemo(() => {
    return (enabled || focused) ? '' : 'opacity-50 group-hover/card:opacity-100'
  }, [enabled, focused])

  const totalText = useMemo(() => {
    const isSearch = inputValue !== '' && isFullDocMode
    if (!isSearch) {
      const text = isFullDocMode
        ? !total
          ? '--'
          : formatNumber(total)
        : formatNumber(childChunks.length)
      const count = isFullDocMode
        ? text === '--'
          ? 0
          : total
        : childChunks.length
      return `${text} ${t('datasetDocuments.segment.childChunks', { count })}`
    }
    else {
      const text = !total ? '--' : formatNumber(total)
      const count = text === '--' ? 0 : total
      return `${count} ${t('datasetDocuments.segment.searchResults', { count })}`
    }
  }, [isFullDocMode, total, childChunks.length, inputValue])

  return (
    <div className={cn(
      'flex flex-col',
      contentOpacity,
      isParagraphMode ? 'pb-2 pt-1' : 'grow px-3',
      (isFullDocMode && isLoading) && 'overflow-y-hidden',
    )}>
      {isFullDocMode ? <Divider type='horizontal' className='my-1 h-px bg-divider-subtle' /> : null}
      <div className={cn('flex items-center justify-between', isFullDocMode ? 'sticky -top-2 left-0 bg-background-default pb-3 pt-2' : '')}>
        <div
          className={cn(
            'flex h-7 items-center rounded-lg pl-1 pr-3',
            isParagraphMode && 'cursor-pointer',
            (isParagraphMode && collapsed) && 'bg-dataset-child-chunk-expand-btn-bg',
            isFullDocMode && 'pl-0',
          )}
          onClick={(event) => {
            event.stopPropagation()
            toggleCollapse()
          }}
        >
          {
            isParagraphMode
              ? collapsed
                ? (
                  <RiArrowRightSLine className='mr-0.5 h-4 w-4 text-text-secondary opacity-50' />
                )
                : (<RiArrowDownSLine className='mr-0.5 h-4 w-4 text-text-secondary' />)
              : null
          }
          <span className='system-sm-semibold-uppercase text-text-secondary'>{totalText}</span>
          <span className={cn('pl-1.5 text-xs font-medium text-text-quaternary', isParagraphMode ? 'hidden group-hover/card:inline-block' : '')}>·</span>
          <button
            type='button'
            className={cn(
              'system-xs-semibold-uppercase px-1.5 py-1 text-components-button-secondary-accent-text',
              isParagraphMode ? 'hidden group-hover/card:inline-block' : '',
              (isFullDocMode && isLoading) ? 'text-components-button-secondary-accent-text-disabled' : '',
            )}
            onClick={(event) => {
              event.stopPropagation()
              handleAddNewChildChunk?.(parentChunkId)
            }}
            disabled={isLoading}
          >
            {t('common.operation.add')}
          </button>
        </div>
        {isFullDocMode
          ? <Input
            showLeftIcon
            showClearIcon
            wrapperClassName='!w-52'
            value={inputValue}
            onChange={e => handleInputChange?.(e.target.value)}
            onClear={() => handleInputChange?.('')}
          />
          : null}
      </div>
      {isLoading ? <FullDocListSkeleton /> : null}
      {((isFullDocMode && !isLoading) || !collapsed)
        ? <div className={cn('flex gap-x-0.5', isFullDocMode ? 'mb-6 grow' : 'items-center')}>
          {isParagraphMode && (
            <div className='self-stretch'>
              <Divider type='vertical' className='mx-[7px] w-[2px] bg-text-accent-secondary' />
            </div>
          )}
          {childChunks.length > 0
            ? <FormattedText className={cn('flex w-full flex-col !leading-6', isParagraphMode ? 'gap-y-2' : 'gap-y-3')}>
              {childChunks.map((childChunk) => {
                const edited = childChunk.updated_at !== childChunk.created_at
                const focused = currChildChunk?.childChunkInfo?.id === childChunk.id
                return <EditSlice
                  key={childChunk.id}
                  label={`C-${childChunk.position}${edited ? ` · ${t('datasetDocuments.segment.edited')}` : ''}`}
                  text={childChunk.content}
                  onDelete={() => onDelete?.(childChunk.segment_id, childChunk.id)}
                  className='child-chunk'
                  labelClassName={focused ? 'bg-state-accent-solid text-text-primary-on-surface' : ''}
                  labelInnerClassName={'text-[10px] font-semibold align-bottom leading-6'}
                  contentClassName={cn('!leading-6', focused ? 'bg-state-accent-hover-alt text-text-primary' : 'text-text-secondary')}
                  showDivider={false}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClickSlice?.(childChunk)
                  }}
                  offsetOptions={({ rects }) => {
                    return {
                      mainAxis: isFullDocMode ? -rects.floating.width : 12 - rects.floating.width,
                      crossAxis: (20 - rects.floating.height) / 2,
                    }
                  }}
                />
              })}
            </FormattedText>
            : inputValue !== ''
              ? <div className='h-full w-full'>
                <Empty onClearFilter={onClearFilter!} />
              </div>
              : null
          }
        </div>
        : null}
    </div>
  )
}

export default ChildSegmentList
