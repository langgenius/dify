import { memo, useCallback, useMemo, useState } from 'react'
import { RiCheckLine, RiCheckboxCircleFill, RiCheckboxCircleLine, RiCloseLine, RiFilter3Line } from '@remixicon/react'
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

const CommentsPanel = () => {
  const activeCommentId = useStore(s => s.activeCommentId)
  const setActiveCommentId = useStore(s => s.setActiveCommentId)
  const setControlMode = useStore(s => s.setControlMode)
  const { comments, loading, loadComments, handleCommentIconClick } = useWorkflowComment()
  const params = useParams()
  const appId = params.appId as string
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const [filter, setFilter] = useState<'all' | 'unresolved' | 'mine'>('all')
  const [showFilter, setShowFilter] = useState(false)

  const handleSelect = useCallback((comment: WorkflowCommentList) => {
    handleCommentIconClick(comment)
  }, [handleCommentIconClick])

  const { userProfile } = useAppContext()

  const filteredSorted = useMemo(() => {
    let data = comments
    if (filter === 'unresolved')
      data = data.filter(c => !c.resolved)
    else if (filter === 'mine')
      data = data.filter(c => c.created_by === userProfile?.id)
    return data
  }, [comments, filter, userProfile?.id])

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

  const handleFilterChange = useCallback((value: 'all' | 'unresolved' | 'mine') => {
    setFilter(value)
    setShowFilter(false)
  }, [])

  return (
    <div className={cn('relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg')}>
      <div className='flex items-center justify-between p-4 pb-2'>
        <div className='system-xl-semibold font-semibold leading-6 text-text-primary'>Comments</div>
        <div className='relative flex items-center gap-2'>
          <button
            className='flex h-8 w-8 items-center justify-center rounded-md bg-components-panel-on-panel-item-bg hover:bg-state-base-hover'
            aria-label='Filter comments'
            onClick={() => setShowFilter(v => !v)}
          >
            <RiFilter3Line className='h-4 w-4 text-text-secondary' />
          </button>
          {showFilter && (
            <div className='absolute right-10 top-9 z-50 w-40 rounded-lg border border-components-panel-border bg-components-panel-bg p-1 shadow-lg'>
              <button
                className={cn('flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-state-base-hover', filter === 'all' && 'bg-components-panel-on-panel-item-bg')}
                onClick={() => handleFilterChange('all')}
              >
                <span className='text-text-secondary'>All</span>
                {filter === 'all' && <RiCheckLine className='h-4 w-4 text-text-secondary' />}
              </button>
              <button
                className={cn('mt-1 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-state-base-hover', filter === 'unresolved' && 'bg-components-panel-on-panel-item-bg')}
                onClick={() => handleFilterChange('unresolved')}
              >
                <span className='text-text-secondary'>Unresolved</span>
                {filter === 'unresolved' && <RiCheckLine className='h-4 w-4 text-text-secondary' />}
              </button>
              <button
                className={cn('mt-1 flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-state-base-hover', filter === 'mine' && 'bg-components-panel-on-panel-item-bg')}
                onClick={() => handleFilterChange('mine')}
              >
                <span className='text-text-secondary'>Only your threads</span>
                {filter === 'mine' && <RiCheckLine className='h-4 w-4 text-text-secondary' />}
              </button>
            </div>
          )}
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
                      {c.reply_count} replies
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {!loading && filteredSorted.length === 0 && (
          <div className='system-sm-regular mt-6 text-center text-text-tertiary'>No comments yet</div>
        )}
      </div>
    </div>
  )
}

export default memo(CommentsPanel)
