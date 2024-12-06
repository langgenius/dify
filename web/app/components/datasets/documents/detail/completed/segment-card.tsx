import React, { type FC, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowRightUpLine, RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import { StatusItem } from '../../list'
import DocumentFileIcon from '../../../common/document-file-icon'
import { useDocumentContext } from '../index'
import ChildSegmentList from './child-segment-list'
import { SegmentIndexTag, useSegmentListContext } from '.'
import type { SegmentDetailModel } from '@/models/datasets'
import Indicator from '@/app/components/header/indicator'
import Switch from '@/app/components/base/switch'
import Divider from '@/app/components/base/divider'
import { formatNumber } from '@/utils/format'
import Confirm from '@/app/components/base/confirm'
import cn from '@/utils/classnames'
import Badge from '@/app/components/base/badge'

const Dot = React.memo(() => {
  return (
    <div className='text-text-quaternary text-xs font-medium'>·</div>
  )
})

Dot.displayName = 'Dot'

const ProgressBar: FC<{ percent: number; loading: boolean }> = React.memo(({ percent, loading }) => {
  return (
    <div className=''>
      <div className=''>
        <div
          className=''
          style={{ width: `${loading ? 0 : (Math.min(percent, 1) * 100).toFixed(2)}%` }}
        />
      </div>
      <div className=''>{loading ? null : percent.toFixed(2)}</div>
    </div>
  )
})

ProgressBar.displayName = 'ProgressBar'

type DocumentTitleProps = {
  name: string
  extension?: string
}

const DocumentTitle: FC<DocumentTitleProps> = React.memo(({ extension, name }) => {
  return (
    <div className=''>
      <DocumentFileIcon name={name} extension={extension} size={'sm'} />
      <span className=''>{name || '--'}</span>
    </div>
  )
})

DocumentTitle.displayName = 'DocumentTitle'

const Tag = React.memo(({ text }: { text: string }) => {
  return (
    <div className='inline-flex items-center gap-x-0.5'>
      <span className='text-text-quaternary text-xs font-medium'>#</span>
      <span className='text-text-tertiary text-xs'>{text}</span>
    </div>
  )
})

Tag.displayName = 'Tag'

export type UsageScene = 'doc' | 'hitTesting'

type ISegmentCardProps = {
  loading: boolean
  detail?: SegmentDetailModel & { document?: { name: string } }
  contentExternal?: string
  refSource?: {
    title: string
    uri: string
  }
  isExternal?: boolean
  score?: number
  onClick?: () => void
  onChangeSwitch?: (enabled: boolean, segId?: string) => Promise<void>
  onDelete?: (segId: string) => Promise<void>
  onClickEdit?: () => void
  scene?: UsageScene
  className?: string
  archived?: boolean
  embeddingAvailable?: boolean
}

const SegmentCard: FC<ISegmentCardProps> = ({
  detail = {},
  contentExternal,
  isExternal,
  refSource,
  score,
  onClick,
  onChangeSwitch,
  onDelete,
  onClickEdit,
  loading = true,
  scene = 'doc',
  className = '',
  archived,
  embeddingAvailable,
}) => {
  const { t } = useTranslation()
  const {
    id,
    position,
    enabled,
    content,
    word_count,
    hit_count,
    answer,
    keywords,
    child_chunks = [],
  } = detail as Required<ISegmentCardProps>['detail']
  const [showModal, setShowModal] = useState(false)
  const isCollapsed = useSegmentListContext(s => s.isCollapsed)
  const [mode, parentMode] = useDocumentContext(s => [s.mode, s.parentMode])

  const isDocScene = useMemo(() => {
    return scene === 'doc'
  }, [scene])

  const isGeneralMode = useMemo(() => {
    return mode === 'custom'
  }, [mode])

  const isFullDocMode = useMemo(() => {
    return mode === 'hierarchical' && parentMode === 'full-doc'
  }, [mode, parentMode])

  // todo: change to real logic
  const chunkEdited = useMemo(() => {
    return mode !== 'hierarchical' || parentMode !== 'full-doc'
  }, [mode, parentMode])

  const textOpacity = useMemo(() => {
    return enabled ? '' : 'opacity-50 group-hover/card:opacity-100'
  }, [enabled])

  const handleClickCard = useCallback(() => {
    if (!isFullDocMode)
      onClick?.()
  }, [isFullDocMode, onClick])

  const renderContent = () => {
    if (answer) {
      return (
        <>
          <div className='flex'>
            <div className='w-4 mr-2 text-[13px] font-medium leading-[20px] text-text-tertiary'>Q</div>
            <div className='text-text-secondary body-md-regular'>{content}</div>
          </div>
          <div className='flex'>
            <div className='w-4 mr-2 text-[13px] font-medium leading-[20px] text-text-tertiary'>A</div>
            <div className='text-text-secondary body-md-regular'>{answer}</div>
          </div>
        </>
      )
    }

    if (contentExternal)
      return contentExternal

    return content
  }

  return (
    <div
      className={cn('w-full px-3 rounded-xl group/card', isFullDocMode ? '' : 'pt-2.5 pb-2 hover:bg-dataset-chunk-detail-card-hover-bg', className)}
      onClick={handleClickCard}
    >
      <div className='h-5 relative flex items-center justify-between'>
        {isDocScene
          ? <>
            <div className='flex items-center gap-x-2'>
              <SegmentIndexTag positionId={position} className={textOpacity} />
              <Dot />
              <div className={cn('text-text-tertiary system-xs-medium', textOpacity)}>{`${formatNumber(word_count)} Characters`}</div>
              <Dot />
              <div className={cn('text-text-tertiary system-xs-medium', textOpacity)}>{`${formatNumber(hit_count)} Retrieval Count`}</div>
              {chunkEdited && (
                <>
                  <Dot />
                  <Badge text='edited' uppercase className={textOpacity} />
                </>
              )}
            </div>
            {!isFullDocMode
              ? <div className='flex items-center'>
                {loading
                  ? (
                    <Indicator color="gray" />
                  )
                  : (
                    <>
                      <StatusItem status={enabled ? 'enabled' : 'disabled'} reverse textCls="text-text-tertiary system-xs-regular" />
                      {embeddingAvailable && (
                        <div className="absolute -top-2 -right-2.5 z-20 hidden group-hover/card:flex items-center gap-x-0.5 p-1
                        rounded-[10px] border-[0.5px] border-components-actionbar-border bg-components-actionbar-bg shadow-md backdrop-blur-[5px]">
                          {!archived && (
                            <>
                              <div
                                className='shrink-0 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-state-base-hover cursor-pointer'
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onClickEdit?.()
                                }}>
                                <RiEditLine className='w-4 h-4 text-text-tertiary' />
                              </div>
                              <div className='shrink-0 w-6 h-6 flex items-center justify-center rounded-lg hover:bg-state-destructive-hover cursor-pointer group/delete'
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setShowModal(true)
                                }
                                }>
                                <RiDeleteBinLine className='w-4 h-4 text-text-tertiary group-hover/delete:text-text-destructive' />
                              </div>
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
                              disabled={archived || detail.status !== 'completed'}
                              defaultValue={enabled}
                              onChange={async (val) => {
                                await onChangeSwitch?.(val, id)
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </>
                  )}
              </div>
              : null}
          </>
          : (
            score !== null
              ? (
                <div className=''>
                  <div className='' />
                  <ProgressBar percent={score ?? 0} loading={loading} />
                </div>
              )
              : null
          )}
      </div>
      {loading
        ? (
          <div className=''>
            <div className='' />
          </div>
        )
        : (
          isDocScene
            ? <>
              <div className={cn('text-text-secondary body-md-regular -tracking-[0.07px] mt-0.5',
                textOpacity,
                isCollapsed ? 'line-clamp-2' : 'line-clamp-20',
              )}>
                {renderContent()}
              </div>
              {isGeneralMode && <div className={cn('flex items-center gap-x-2 py-1.5', textOpacity)}>
                {keywords?.map(keyword => <Tag key={keyword} text={keyword} />)}
              </div>}
              {
                isFullDocMode
                  ? <button className='mt-0.5 mb-2 text-text-accent system-xs-semibold-uppercase' onClick={() => onClick?.()}>VIEW MORE</button>
                  : null
              }
              {
                child_chunks.length > 0
                && <ChildSegmentList
                  childChunks={child_chunks}
                  handleInputChange={() => {}}
                  enabled={enabled}
                />
              }
            </>
            : <>
              <div className='text-text-secondary body-md-regular -tracking-[0.07px]'>
                {renderContent()}
              </div>
              <div className=''>
                <Divider />
                <div className="relative flex items-center w-full pb-1">
                  <DocumentTitle
                    name={detail?.document?.name || refSource?.title || ''}
                    extension={(detail?.document?.name || refSource?.title || '').split('.').pop() || 'txt'}
                  />
                  <div className=''>
                    {isExternal ? t('datasetHitTesting.viewDetail') : t('datasetHitTesting.viewChart')}
                    <RiArrowRightUpLine className="w-3.5 h-3.5 ml-1" />
                  </div>
                </div>
              </div>
            </>
        )}
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
