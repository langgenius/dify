import { memo, useCallback, useMemo, useState } from 'react'
import { useReactFlow } from 'reactflow'
import { RiCheckboxCircleFill, RiCheckboxCircleLine, RiCloseLine } from '@remixicon/react'
import { useStore } from '@/app/components/workflow/store'
import type { WorkflowCommentList } from '@/service/workflow-comment'
import { useWorkflowComment } from '@/app/components/workflow/hooks/use-workflow-comment'
import Avatar from '@/app/components/base/avatar'
import cn from '@/utils/classnames'
import { ControlMode } from '@/app/components/workflow/types'
import { resolveWorkflowComment } from '@/service/workflow-comment'
import { useParams } from 'next/navigation'
import { useFormatTimeFromNow } from '@/app/components/workflow/hooks'

const CommentsPanel = () => {
  const activeCommentId = useStore(s => s.activeCommentId)
  const setActiveCommentId = useStore(s => s.setActiveCommentId)
  const setControlMode = useStore(s => s.setControlMode)
  const { comments, loading, loadComments } = useWorkflowComment()
  const reactFlow = useReactFlow()
  const params = useParams()
  const appId = params.appId as string
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const [filter, setFilter] = useState<'all' | 'unresolved'>('all')

  const handleSelect = useCallback((comment: WorkflowCommentList) => {
    // center viewport on the comment position and activate it
    reactFlow.setCenter(comment.position_x, comment.position_y, { zoom: 1, duration: 600 })
    setActiveCommentId(comment.id)
  }, [reactFlow, setActiveCommentId])

  const filteredSorted = useMemo(() => {
    let data = comments
    if (filter === 'unresolved')
      data = data.filter(c => !c.resolved)
    return data
  }, [comments, filter])

  const handleResolve = useCallback(async (comment: WorkflowCommentList) => {
    if (comment.resolved) return
    if (!appId) return
    try {
      await resolveWorkflowComment(appId, comment.id)
      await loadComments()
      setActiveCommentId(comment.id)
    }
    catch (e) {
      console.error('Resolve comment failed', e)
    }
  }, [appId, loadComments, setActiveCommentId])

  return (
    <div className={cn('relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt')}>
      <div className='flex items-center justify-between p-4 pb-2'>
        <div className='system-xl-semibold text-text-primary'>Comments</div>
        <div className='flex items-center gap-2'>
          <div
            className={cn('inline-flex rounded-md bg-components-panel-on-panel-item-bg px-1 py-1')}
            role='group'
          >
            <button
              className={cn('system-xs-medium rounded px-2 py-1', filter === 'all' ? 'bg-white text-text-primary' : 'text-text-tertiary hover:text-text-secondary')}
              onClick={() => setFilter('all')}
            >All</button>
            <button
              className={cn('system-xs-medium rounded px-2 py-1', filter === 'unresolved' ? 'bg-white text-text-primary' : 'text-text-tertiary hover:text-text-secondary')}
              onClick={() => setFilter('unresolved')}
            >Unresolved</button>
          </div>
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
      <div className='grow overflow-y-auto px-3 pb-4'>
        {filteredSorted.map((c) => {
          const isActive = activeCommentId === c.id
          return (
            <div
              key={c.id}
              className={cn('group mb-2 cursor-pointer rounded-xl border border-components-panel-border bg-components-panel-bg p-3 transition-colors hover:bg-components-panel-on-panel-item-bg-hover', isActive && 'ring-1 ring-primary-500')}
              onClick={() => handleSelect(c)}
            >
              <div className='min-w-0'>
                {/* Participants stacked avatars above creator name */}
                {(() => {
                  const creator = {
                    id: c.created_by,
                    name: c.created_by_account?.name || 'User',
                    avatar_url: c.created_by_account?.avatar_url || null,
                  }
                  const collaborators = (c.participants || []).filter(p => p.id !== creator.id)
                  const all = [creator, ...collaborators]
                  if (!all.length) return null
                  const shouldShowCount = all.length >= 4
                  const maxVisible = shouldShowCount ? 2 : 3
                  const visibleUsers = all.slice(0, maxVisible)
                  const remainingCount = all.length - maxVisible
                  return (
                    <div className='mb-1 flex items-center -space-x-1'>
                      {visibleUsers.map((p, index) => (
                        <div
                          key={`${p.id}-${index}`}
                          className='relative'
                          style={{ zIndex: visibleUsers.length - index }}
                        >
                          <Avatar
                            name={p.name}
                            avatar={p.avatar_url || null}
                            size={18}
                            className='ring-2 ring-white'
                          />
                        </div>
                      ))}
                      {remainingCount > 0 && (
                        <div
                          className='flex h-[18px] w-[18px] items-center justify-center rounded-full bg-components-panel-on-panel-item-bg text-[10px] leading-none text-text-secondary ring-2 ring-white'
                          style={{ zIndex: 0 }}
                        >
                          +{remainingCount}
                        </div>
                      )}
                    </div>
                  )
                })()}
                {/* Header row: creator + time + right-top status/action icons */}
                <div className='flex items-start justify-between'>
                  <div className='flex min-w-0 items-center gap-2'>
                    <div className='system-sm-medium truncate text-text-primary'>{c.created_by_account.name}</div>
                    <div className='system-2xs-regular shrink-0 text-text-tertiary'>
                      {formatTimeFromNow(c.updated_at * 1000)}
                    </div>
                  </div>
                  <div className='flex items-center gap-1'>
                    {c.resolved ? (
                      <RiCheckboxCircleFill className='h-4 w-4'/>
                    ) : (
                      <RiCheckboxCircleLine
                        className='h-4 w-4 cursor-pointer text-text-tertiary hover:text-text-secondary'
                        onClick={() => { handleResolve(c) }}
                      />
                    )}
                  </div>
                </div>
                {/* Content */}
                <div className='system-sm-regular mt-1 line-clamp-3 break-words text-text-secondary'>{c.content}</div>
                {/* Footer */}
                <div className='mt-2 flex items-center justify-between'>
                  <div className='system-2xs-regular text-text-tertiary'>
                    {c.reply_count} replies
                  </div>
                </div>
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
