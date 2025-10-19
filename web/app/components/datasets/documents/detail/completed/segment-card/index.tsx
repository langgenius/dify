import React, { type FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import StatusItem from '../../../status-item'
import { useDocumentContext } from '../../context'
import ChildSegmentList from '../child-segment-list'
import Tag from '../common/tag'
import Dot from '../common/dot'
import { SegmentIndexTag } from '../common/segment-index-tag'
import ParentChunkCardSkeleton from '../skeleton/parent-chunk-card-skeleton'
import { type ChildChunkDetail, ChunkingMode, type SegmentDetailModel } from '@/models/datasets'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import { formatNumber } from '@/utils/format'
import Confirm from '@/app/components/base/confirm'
import cn from '@/utils/classnames'
import Badge from '@/app/components/base/badge'
import { isAfter } from '@/utils/time'
import Tooltip from '@/app/components/base/tooltip'
import ChunkContent from './chunk-content'

type ISegmentCardProps = {
  loading: boolean
  detail?: SegmentDetailModel & { document?: { name: string } }
  onClick?: () => void
  onChangeSwitch?: (enabled: boolean, segId?: string) => Promise<void>
  onDelete?: (segId: string) => Promise<void>
  onDeleteChildChunk?: (segId: string, childChunkId: string) => Promise<void>
  handleAddNewChildChunk?: (parentChunkId: string) => void
  onClickSlice?: (childChunk: ChildChunkDetail) => void
  onClickEdit?: () => void
  className?: string
  archived?: boolean
  embeddingAvailable?: boolean
  focused: {
    segmentIndex: boolean
    segmentContent: boolean
  }
}

const SegmentCard: FC<ISegmentCardProps> = ({
  detail = {},
  onClick,
  onChangeSwitch,
  onDelete,
  onDeleteChildChunk,
  handleAddNewChildChunk,
  onClickSlice,
  onClickEdit,
  loading = true,
  className = '',
  archived,
  embeddingAvailable,
  focused,
}) => {
  const { t } = useTranslation()
  const {
    id,
    position,
    enabled,
    content,
    sign_content,
    word_count,
    hit_count,
    answer,
    keywords,
    child_chunks = [],
    created_at,
    updated_at,
  } = detail as Required<ISegmentCardProps>['detail']
  const [showModal, setShowModal] = useState(false)
  const docForm = useDocumentContext(s => s.docForm)
  const parentMode = useDocumentContext(s => s.parentMode)

  const isGeneralMode = useMemo(() => {
    return docForm === ChunkingMode.text
  }, [docForm])

  const isParentChildMode = useMemo(() => {
    return docForm === ChunkingMode.parentChild
  }, [docForm])

  const isParagraphMode = useMemo(() => {
    return docForm === ChunkingMode.parentChild && parentMode === 'paragraph'
  }, [docForm, parentMode])

  const isFullDocMode = useMemo(() => {
    return docForm === ChunkingMode.parentChild && parentMode === 'full-doc'
  }, [docForm, parentMode])

  const chunkEdited = useMemo(() => {
    if (docForm === ChunkingMode.parentChild && parentMode === 'full-doc')
      return false
    return isAfter(updated_at * 1000, created_at * 1000)
  }, [docForm, parentMode, updated_at, created_at])

  const contentOpacity = useMemo(() => {
    return (enabled || focused.segmentContent) ? '' : 'opacity-50 group-hover/card:opacity-100'
  }, [enabled, focused.segmentContent])

  const handleClickCard = useCallback(() => {
    if (docForm !== ChunkingMode.parentChild || parentMode !== 'full-doc')
      onClick?.()
  }, [docForm, parentMode, onClick])

  const wordCountText = useMemo(() => {
    const total = formatNumber(word_count)
    return `${total} ${t('datasetDocuments.segment.characters', { count: word_count })}`
  }, [word_count, t])

  const labelPrefix = useMemo(() => {
    return isParentChildMode ? t('datasetDocuments.segment.parentChunk') : t('datasetDocuments.segment.chunk')
  }, [isParentChildMode, t])

  if (loading)
    return <ParentChunkCardSkeleton />

  return (
    <div
      className={cn(
        'chunk-card group/card w-full rounded-xl px-3',
        isFullDocMode ? '' : 'pb-2 pt-2.5 hover:bg-dataset-chunk-detail-card-hover-bg',
        focused.segmentContent ? 'bg-dataset-chunk-detail-card-hover-bg' : '',
        className,
      )}
      onClick={handleClickCard}
    >
      <div className='relative flex h-5 items-center justify-between'>
        <>
          <div className='flex items-center gap-x-2'>
            <SegmentIndexTag
              className={cn(contentOpacity)}
              iconClassName={focused.segmentIndex ? 'text-text-accent' : ''}
              labelClassName={focused.segmentIndex ? 'text-text-accent' : ''}
              positionId={position}
              label={isFullDocMode ? labelPrefix : ''}
              labelPrefix={labelPrefix}
            />
            <Dot />
            <div className={cn('system-xs-medium text-text-tertiary', contentOpacity)}>{wordCountText}</div>
            <Dot />
            <div className={cn('system-xs-medium text-text-tertiary', contentOpacity)}>{`${formatNumber(hit_count)} ${t('datasetDocuments.segment.hitCount')}`}</div>
            {chunkEdited && (
              <>
                <Dot />
                <Badge text={t('datasetDocuments.segment.edited') as string} uppercase className={contentOpacity} />
              </>
            )}
          </div>
          {!isFullDocMode
            ? <div className='flex items-center'>
              <StatusItem status={enabled ? 'enabled' : 'disabled'} reverse textCls="text-text-tertiary system-xs-regular" />
              {embeddingAvailable && (
                <div className="absolute -right-2.5 -top-2 z-20 hidden items-center gap-x-0.5 rounded-[10px] border-[0.5px]
                      border-components-actionbar-border bg-components-actionbar-bg p-1 shadow-md backdrop-blur-[5px] group-hover/card:flex">
                  {!archived && (
                    <>
                      <Tooltip
                        popupContent='Edit'
                        popupClassName='text-text-secondary system-xs-medium'
                      >
                        <div
                          className='flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-state-base-hover'
                          onClick={(e) => {
                            e.stopPropagation()
                            onClickEdit?.()
                          }}>
                          <RiEditLine className='h-4 w-4 text-text-tertiary' />
                        </div>
                      </Tooltip>
                      <Tooltip
                        popupContent='Delete'
                        popupClassName='text-text-secondary system-xs-medium'
                      >
                        <div className='group/delete flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-state-destructive-hover'
                          onClick={(e) => {
                            e.stopPropagation()
                            setShowModal(true)
                          }
                          }>
                          <RiDeleteBinLine className='h-4 w-4 text-text-tertiary group-hover/delete:text-text-destructive' />
                        </div>
                      </Tooltip>
                      <Divider type="vertical" className="h-3.5 bg-divider-regular" />
                    </>
                  )}
                  <div
                    onClick={(e: React.MouseEvent<HTMLDivElement, MouseEvent>) =>
                      e.stopPropagation()
                    }
                    className="flex items-center"
                  >
                    <Switch
                      size='md'
                      disabled={archived || detail?.status !== 'completed'}
                      defaultValue={enabled}
                      onChange={async (val) => {
                        await onChangeSwitch?.(val, id)
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            : null}
        </>
      </div>
      <ChunkContent
        detail={{
          answer,
          content,
          sign_content,
        }}
        isFullDocMode={isFullDocMode}
        className={contentOpacity}
      />
      {isGeneralMode && <div className={cn('flex flex-wrap items-center gap-2 py-1.5', contentOpacity)}>
        {keywords?.map(keyword => <Tag key={keyword} text={keyword} />)}
      </div>}
      {
        isFullDocMode
          ? <button
            type='button'
            className='system-xs-semibold-uppercase mb-2 mt-0.5 text-text-accent'
            onClick={() => onClick?.()}
          >{t('common.operation.viewMore')}</button>
          : null
      }
      {
        isParagraphMode && child_chunks.length > 0
        && <ChildSegmentList
          parentChunkId={id}
          childChunks={child_chunks}
          enabled={enabled}
          onDelete={onDeleteChildChunk!}
          handleAddNewChildChunk={handleAddNewChildChunk}
          onClickSlice={onClickSlice}
          focused={focused.segmentContent}
        />
      }
      {showModal
        && <Confirm
          isShow={showModal}
          title={t('datasetDocuments.segment.delete')}
          confirmText={t('common.operation.sure')}
          onConfirm={async () => { await onDelete?.(id) }}
          onCancel={() => setShowModal(false)}
        />
      }
    </div>
  )
}

export default React.memo(SegmentCard)
