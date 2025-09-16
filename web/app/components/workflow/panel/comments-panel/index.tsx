import { memo, useCallback, useMemo } from 'react'
import { useReactFlow } from 'reactflow'
import { RiCloseLine } from '@remixicon/react'
import { useStore } from '@/app/components/workflow/store'
import type { WorkflowCommentList } from '@/service/workflow-comment'
import { useWorkflowComment } from '@/app/components/workflow/hooks/use-workflow-comment'
import Avatar from '@/app/components/base/avatar'
import cn from '@/utils/classnames'
import { ControlMode } from '@/app/components/workflow/types'

const CommentsPanel = () => {
  const activeCommentId = useStore(s => s.activeCommentId)
  const setActiveCommentId = useStore(s => s.setActiveCommentId)
  const setControlMode = useStore(s => s.setControlMode)
  const { comments, loading } = useWorkflowComment()
  const reactFlow = useReactFlow()

  const handleSelect = useCallback((comment: WorkflowCommentList) => {
    // center viewport on the comment position and activate it
    reactFlow.setCenter(comment.position_x, comment.position_y, { zoom: 1, duration: 600 })
    setActiveCommentId(comment.id)
  }, [reactFlow, setActiveCommentId])

  const sorted = useMemo(() => {
    return [...comments].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }, [comments])

  return (
    <div className={cn('relative flex h-full w-[420px] flex-col rounded-l-2xl border border-components-panel-border bg-components-panel-bg-alt')}>
      <div className='system-xl-semibold flex shrink-0 items-center justify-between p-4 pb-2 text-text-primary'>
        Comments
        <div className='flex items-center'>
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
      <div className='system-sm-regular shrink-0 px-4 pb-2 text-text-tertiary'>
        {loading ? 'Loading…' : `${sorted.length} comment${sorted.length === 1 ? '' : 's'}`}
      </div>
      <div className='grow overflow-y-auto px-3 pb-4'>
        {sorted.map((c) => {
          const isActive = activeCommentId === c.id
          return (
            <div
              key={c.id}
              className={cn(
                'group mb-2 cursor-pointer rounded-xl border border-components-panel-border bg-components-panel-bg p-3 transition-colors hover:bg-components-panel-on-panel-item-bg-hover',
                isActive && 'ring-1 ring-primary-500',
              )}
              onClick={() => handleSelect(c)}
            >
              <div className='flex items-start gap-2'>
                <Avatar
                  avatar={c.created_by_account.avatar_url || null}
                  name={c.created_by_account.name}
                  size={28}
                  className='shrink-0'
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-2'>
                    <div className='system-sm-medium truncate text-text-primary'>{c.created_by_account.name}</div>
                    {c.resolved && <span className='system-2xs-medium rounded-md bg-util-colors-green-green-100 px-1 py-0.5 text-util-colors-green-green-700'>Resolved</span>}
                  </div>
                  <div className='system-sm-regular mt-0.5 line-clamp-3 break-words text-text-secondary'>{c.content}</div>
                  <div className='system-2xs-regular mt-1 text-text-tertiary'>
                    {c.reply_count} replies • {c.mention_count} mentions
                  </div>
                </div>
              </div>
            </div>
          )
        })}
        {!loading && sorted.length === 0 && (
          <div className='system-sm-regular mt-6 text-center text-text-tertiary'>No comments yet</div>
        )}
      </div>
    </div>
  )
}

export default memo(CommentsPanel)
