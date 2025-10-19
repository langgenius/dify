import React, { type FC } from 'react'
import cn from '@/utils/classnames'
import { useSegmentListContext } from '..'
import { Markdown } from '@/app/components/base/markdown'

type ChunkContentProps = {
  detail: {
    answer?: string
    content: string
    sign_content: string
  }
  isFullDocMode: boolean
  className?: string
}

const ChunkContent: FC<ChunkContentProps> = ({
  detail,
  isFullDocMode,
  className,
}) => {
  const { answer, content, sign_content } = detail
  const isCollapsed = useSegmentListContext(s => s.isCollapsed)

  if (answer) {
    return (
      <div className={className}>
        <div className='flex gap-x-1'>
          <div className='w-4 shrink-0 text-[13px] font-medium leading-[20px] text-text-tertiary'>Q</div>
          <Markdown
            className={cn('body-md-regular text-text-secondary',
              isCollapsed ? 'line-clamp-2' : 'line-clamp-20',
            )}
            content={content}
            customDisallowedElements={['input']}
          />
        </div>
        <div className='flex gap-x-1'>
          <div className='w-4 shrink-0 text-[13px] font-medium leading-[20px] text-text-tertiary'>A</div>
          <Markdown
            className={cn('body-md-regular text-text-secondary',
              isCollapsed ? 'line-clamp-2' : 'line-clamp-20',
            )}
            content={answer}
            customDisallowedElements={['input']}
          />
        </div>
      </div>
    )
  }
  return (
    <Markdown
      className={cn('!mt-0.5 !text-text-secondary',
        isFullDocMode ? 'line-clamp-3' : isCollapsed ? 'line-clamp-2' : 'line-clamp-20',
        className,
      )}
      content={sign_content || content || ''}
      customDisallowedElements={['input']}
    />
  )
}

export default React.memo(ChunkContent)
