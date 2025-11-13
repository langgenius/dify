import { memo, useCallback, useMemo, useState } from 'react'
import { RiCheckLine, RiCheckboxCircleFill, RiCheckboxCircleLine, RiCloseLine, RiFilter3Line } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/app/components/workflow/store'
import type { WorkflowCommentList } from '@/service/workflow-comment'
import { useWorkflowComment } from '@/app/components/workflow/hooks/use-workflow-comment'
import { UserAvatarList } from '@/app/components/base/user-avatar-list'
import cn from '@/utils/classnames'
import { ControlMode } from '@/app/components/workflow/types'
import { resolveWorkflowComment } from '@/service/workflow-comment'
import { useParams } from 'next/navigation'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useAppContext } from '@/context/app-context'
import { collaborationManager } from '@/app/components/workflow/collaboration'
import Divider from '@/app/components/base/divider'
import Switch from '@/app/components/base/switch'

const CommentsPanel = () => {
  const { t } = useTranslation()
  const activeCommentId = useStore(s => s.activeCommentId)
  const setActiveCommentId = useStore(s => s.setActiveCommentId)
  const setControlMode = useStore(s => s.setControlMode)
  const { comments, loading, loadComments, handleCommentIconClick } = useWorkflowComment()
  const params = useParams()
  const appId = params.appId as string
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const [showOnlyMine, setShowOnlyMine] = useState(false)
  const [showOnlyUnresolved, setShowOnlyUnresolved] = useState(false)
  const [showFilter, setShowFilter] = useState(false)

  const handleSelect = useCallback((comment: WorkflowCommentList) => {
    handleCommentIconClick(comment)
  }, [handleCommentIconClick])

  const { userProfile } = useAppContext()

  const filteredSorted = useMemo(() => {
    let data = comments
    if (showOnlyUnresolved)
      data = data.filter(c => !c.resolved)
    if (showOnlyMine)
      data = data.filter(c => c.created_by === userProfile?.id)
    return data
  }, [comments, showOnlyMine, showOnlyUnresolved, userProfile?.id])

  const handleResolve = useCallback(async (comment: WorkflowCommentList) => {
    if (comment.resolved) return
    if (!appId) return
    try {
      await resolveWorkflowComment(appId, comment.id)

      collaborationManager.emitCommentsUpdate(appId)

      await loadComments()
      setActiveCommentId(comment.id)
    }
    catch (e) {
      console.error('Resolve comment failed', e)
    }
  }, [appId, loadComments, setActiveCommentId])

  const hasActiveFilter = showOnlyMine || !showOnlyUnresolved

  return (
    <div className={cn('relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg')}>
      <div className='flex items-center justify-between p-4 pb-2'>
        <div className='system-xl-semibold font-semibold leading-6 text-text-primary'>{t('workflow.comments.panelTitle')}</div>
        <div className='relative flex items-center gap-2'>
          <button
            className={cn(
              'group flex h-6 w-6 items-center justify-center rounded-md hover:bg-state-accent-active',
              hasActiveFilter && 'bg-state-accent-active',
            )}
            aria-label='Filter comments'
            onClick={() => setShowFilter(v => !v)}
          >
            <RiFilter3Line className={cn(
              'h-4 w-4 text-text-secondary group-hover:text-text-accent',
              hasActiveFilter && 'text-text-accent',
            )} />
          </button>
          {showFilter && (
            <div className='absolute right-10 top-9 z-50 min-w-[184px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[10px]'>
              <button
                className={cn('flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-state-base-hover', !showOnlyMine && 'bg-components-panel-on-panel-item-bg')}
                onClick={() => {
                  setShowOnlyMine(false)
                  setShowFilter(false)
                }}
              >
                <span className='text-text-secondary'>All</span>
                {!showOnlyMine && <RiCheckLine className='h-4 w-4 text-primary-600' />}
              </button>
              <button
                className={cn('mt-1 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-state-base-hover', showOnlyMine && 'bg-components-panel-on-panel-item-bg')}
                onClick={() => {
                  setShowOnlyMine(true)
                  setShowFilter(false)
                }}
              >
                <span className='text-text-secondary'>Only your threads</span>
                {showOnlyMine && <RiCheckLine className='h-4 w-4 text-primary-600' />}
              </button>
              <Divider type='horizontal' className='my-1' />
              <div
                className='flex w-full items-center justify-between rounded-md px-2 py-2'
                onClick={(e) => {
                  e.stopPropagation()
                }}
              >
                <span className='text-sm text-text-secondary'>Show resolved</span>
                <Switch
                  size='md'
                  defaultValue={!showOnlyUnresolved}
                  onChange={(checked) => {
                    setShowOnlyUnresolved(!checked)
                  }}
                />
              </div>
            </div>
          )}
          <Divider type='vertical' className='h-3.5' />
          <div
            className='flex h-6 w-6 cursor-pointer items-center justify-center'
            onClick={() => {
              setControlMode(ControlMode.Pointer)
              setActiveCommentId(null)
            }}
          >
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className='grow overflow-y-auto px-1'>
        {filteredSorted.map((c) => {
          const isActive = activeCommentId === c.id
          return (
            <div
              key={c.id}
              className={cn('group mb-2 cursor-pointer rounded-xl bg-components-panel-bg p-3 transition-colors hover:bg-components-panel-on-panel-item-bg-hover', isActive && 'bg-components-panel-on-panel-item-bg-hover')}
              onClick={() => handleSelect(c)}
            >
              <div className='min-w-0'>
                <div className='mb-1 flex items-center justify-between'>
                  <UserAvatarList
                    users={c.participants}
                    maxVisible={3}
                    size={24}
                  />
                  <div className='ml-2 flex items-center'>
                    {c.resolved ? (
                      <RiCheckboxCircleFill className='h-4 w-4 text-text-secondary'/>
                    ) : (
                      <RiCheckboxCircleLine
                        className='h-4 w-4 cursor-pointer text-text-tertiary hover:text-text-secondary'
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleResolve(c)
                        }}
                      />
                    )}
                  </div>
                </div>
                {/* Header row: creator + time */}
                <div className='flex items-start'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <div className='system-sm-medium truncate text-text-primary'>{c.created_by_account.name}</div>
                    <div className='system-2xs-regular shrink-0 text-text-tertiary'>
                      {formatTimeFromNow(c.updated_at * 1000)}
                    </div>
                  </div>
                </div>
                {/* Content */}
                <div className='system-sm-regular mt-1 line-clamp-3 break-words text-text-secondary'>{c.content}</div>
                {/* Footer */}
                {c.reply_count > 0 && (
                  <div className='mt-2 flex items-center justify-between'>
                    <div className='system-2xs-regular text-text-tertiary'>
                      {c.reply_count} {t('workflow.comments.reply')}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {!loading && filteredSorted.length === 0 && (
          <div className='system-sm-regular mt-6 text-center text-text-tertiary'>{t('workflow.comments.noComments')}</div>
        )}
      </div>
    </div>
  )
}

export default memo(CommentsPanel)
