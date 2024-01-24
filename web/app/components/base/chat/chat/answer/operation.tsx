import type { FC } from 'react'
import type { ChatItem } from '../../types'
import { useCurrentAnswerIsResponsing } from '../hooks'
import CopyBtn from '@/app/components/app/chat/copy-btn'
import { MessageFast } from '@/app/components/base/icons/src/vender/solid/communication'

type OperationProps = {
  item: ChatItem
}
const Operation: FC<OperationProps> = ({
  item,
}) => {
  const responsing = useCurrentAnswerIsResponsing(item.id)
  const {
    isOpeningStatement,
    content,
    annotation,
  } = item

  return (
    <div className='absolute top-[-14px] right-[-14px] flex justify-end gap-1'>
      {
        !isOpeningStatement && !responsing && (
          <CopyBtn
            value={content}
            className='hidden group-hover:block'
          />
        )
      }
      {
        annotation?.id && (
          <div
            className='relative box-border flex items-center justify-center h-7 w-7 p-0.5 rounded-lg bg-white cursor-pointer text-[#444CE7] shadow-md'
          >
            <div className='p-1 rounded-lg bg-[#EEF4FF] '>
              <MessageFast className='w-4 h-4' />
            </div>
          </div>
        )
      }
    </div>
  )
}

export default Operation
