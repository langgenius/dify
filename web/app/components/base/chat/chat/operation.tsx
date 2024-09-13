import type { FC } from 'react'
import {
  memo,
} from 'react'
import type { ChatItem } from './../types'
import cn from '@/utils/classnames'
import CopyBtn from '@/app/components/base/copy-btn'
import ResendBtn from '@/app/components/base/resend-btn'

type OperationProps = {
  item: ChatItem
}
const Operation: FC<OperationProps> = ({
  item,
}) => {
  const {
    isOpeningStatement,
    content,
    message_files,
  } = item

  return (
    <>
      <div
        className={cn('absolute flex justify-end gap-1 -top-3.5 right-0')}
      >
        {!isOpeningStatement && (
          <div className='hidden group-hover:flex items-center w-max h-[28px] p-0.5 rounded-lg bg-white border-[0.5px] border-gray-100 shadow-md shrink-0'>
            <CopyBtn
              value={content}
              className='hidden group-hover:block'
            />
            <ResendBtn
              value={content}
              files={message_files}
              className='hidden group-hover:block'
            />
          </div>
        )}

      </div>
    </>
  )
}

export default memo(Operation)
