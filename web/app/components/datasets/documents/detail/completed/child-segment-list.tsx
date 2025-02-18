import { type FC, useMemo, useState } from 'react'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { EditSlice } from '../../../formatted-text/flavours/edit-slice'
import { useDocumentContext } from '../index'
import { FormattedText } from '../../../formatted-text/formatted'
import Empty from './common/empty'
import FullDocListSkeleton from './skeleton/full-doc-list-skeleton'
import { useSegmentListContext } from './index'
import type { ChildChunkDetail } from '@/models/datasets'
import Input from '@/app/components/base/input'
import classNames from '@/utils/classnames'
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullDocMode, total, childChunks.length, inputValue])

  return (
    <div className={classNames(
      'flex flex-col',
      contentOpacity,
      isParagraphMode ? 'pt-1 pb-2' : 'px-3 grow',
      (isFullDocMode && isLoading) && 'overflow-y-hidden',
    )}>
      {isFullDocMode ? <Divider type='horizontal' className='bg-divider-subtle my-1 h-[1px]' /> : null}
      <div className={classNames('flex items-center justify-between', isFullDocMode ? 'pt-2 pb-3 sticky -top-2 left-0 bg-background-default' : '')}>
        <div className={classNames(
          'h-7 flex items-center pl-1 pr-3 rounded-lg',
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
                  <RiArrowRightSLine className='text-text-secondary mr-0.5 h-4 w-4 opacity-50' />
                )
                : (<RiArrowDownSLine className='text-text-secondary mr-0.5 h-4 w-4' />)
              : null
          }
          <span className='text-text-secondary system-sm-semibold-uppercase'>{totalText}</span>
          <span className={classNames('text-text-quaternary text-xs font-medium pl-1.5', isParagraphMode ? 'hidden group-hover/card:inline-block' : '')}>·</span>
          <button
            type='button'
            className={classNames(
              'px-1.5 py-1 text-components-button-secondary-accent-text system-xs-semibold-uppercase',
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
        ? <div className={classNames('flex gap-x-0.5', isFullDocMode ? 'grow mb-6' : 'items-center')}>
          {isParagraphMode && (
            <div className='self-stretch'>
              <Divider type='vertical' className='bg-text-accent-secondary mx-[7px] w-[2px]' />
            </div>
          )}
          {childChunks.length > 0
            ? <FormattedText className={classNames('w-full !leading-6 flex flex-col', isParagraphMode ? 'gap-y-2' : 'gap-y-3')}>
              {childChunks.map((childChunk) => {
                const edited = childChunk.updated_at !== childChunk.created_at
                const focused = currChildChunk?.childChunkInfo?.id === childChunk.id
                return <EditSlice
                  key={childChunk.id}
                  label={`C-${childChunk.position}${edited ? ` · ${t('datasetDocuments.segment.edited')}` : ''}`}
                  text={childChunk.content}
                  onDelete={() => onDelete?.(childChunk.segment_id, childChunk.id)}
                  labelClassName={focused ? 'bg-state-accent-solid text-text-primary-on-surface' : ''}
                  labelInnerClassName={'text-[10px] font-semibold align-bottom leading-6'}
                  contentClassName={classNames('!leading-6', focused ? 'bg-state-accent-hover-alt text-text-primary' : '')}
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
