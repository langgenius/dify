'use client'

import type { FC } from 'react'
import { memo, useMemo } from 'react'
import { useReactFlow, useViewport } from 'reactflow'
import { RiCloseLine } from '@remixicon/react'
import Avatar from '@/app/components/base/avatar'
import cn from '@/utils/classnames'
import { useFormatTimeFromNow } from '@/app/components/workflow/hooks'
import type { WorkflowCommentDetail, WorkflowCommentDetailReply } from '@/service/workflow-comment'

type CommentThreadProps = {
  comment: WorkflowCommentDetail
  loading?: boolean
  onClose: () => void
}

const ThreadMessage: FC<{
  authorName: string
  avatarUrl?: string | null
  createdAt: number
  content: string
  isReply?: boolean
}> = ({ authorName, avatarUrl, createdAt, content, isReply }) => {
  const { formatTimeFromNow } = useFormatTimeFromNow()

  return (
    <div className={cn('flex gap-3', isReply && 'pl-9')}>
      <div className='shrink-0'>
        <Avatar
          name={authorName}
          avatar={avatarUrl || null}
          size={32}
          className='h-8 w-8'
        />
      </div>
      <div className='min-w-0 flex-1 pb-4 text-text-primary last:pb-0'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <span className='system-sm-medium text-text-primary'>{authorName}</span>
          <span className='system-2xs-regular text-text-tertiary'>{formatTimeFromNow(createdAt * 1000)}</span>
        </div>
        <div className='system-sm-regular mt-1 whitespace-pre-wrap break-words text-text-secondary'>
          {content}
        </div>
      </div>
    </div>
  )
}

const renderReply = (reply: WorkflowCommentDetailReply) => (
  <ThreadMessage
    key={reply.id}
    authorName={reply.created_by_account?.name || 'User'}
    avatarUrl={reply.created_by_account?.avatar_url || null}
    createdAt={reply.created_at}
    content={reply.content}
    isReply
  />
)

export const CommentThread: FC<CommentThreadProps> = memo(({ comment, loading = false, onClose }) => {
  const { flowToScreenPosition } = useReactFlow()
  const viewport = useViewport()

  const screenPosition = useMemo(() => {
    return flowToScreenPosition({
      x: comment.position_x,
      y: comment.position_y,
    })
  }, [comment.position_x, comment.position_y, viewport.x, viewport.y, viewport.zoom, flowToScreenPosition])

  return (
    <div
      className='absolute z-50 w-[360px] max-w-[360px]'
      style={{
        left: screenPosition.x,
        top: screenPosition.y,
        transform: 'translate(-50%, -100%) translateY(-24px)',
      }}
    >
      <div className='relative rounded-2xl border border-components-panel-border bg-components-panel-bg shadow-xl'>
        <div className='flex items-center justify-between rounded-t-2xl px-4 py-3'>
          <div className='system-2xs-semibold uppercase tracking-[0.08em] text-text-tertiary'>Comment</div>
          <button
            type='button'
            className='flex h-6 w-6 items-center justify-center rounded-full text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary'
            onClick={onClose}
            aria-label='Close comment'
          >
            <RiCloseLine className='h-4 w-4' />
          </button>
        </div>
        <div className='relative px-4 pb-4'>
          <ThreadMessage
            authorName={comment.created_by_account?.name || 'User'}
            avatarUrl={comment.created_by_account?.avatar_url || null}
            createdAt={comment.created_at}
            content={comment.content}
          />
          {comment.replies?.length > 0 && (
            <div className='mt-2 flex flex-col gap-2'>
              {comment.replies.map(renderReply)}
            </div>
          )}
        </div>
        {loading && (
          <div className='bg-components-panel-bg/70 absolute inset-0 flex items-center justify-center rounded-2xl text-sm text-text-tertiary'>
            Loading…
          </div>
        )}
      </div>
    </div>
  )
})

CommentThread.displayName = 'CommentThread'
