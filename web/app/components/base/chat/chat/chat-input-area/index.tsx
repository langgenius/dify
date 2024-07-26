import {
  memo,
} from 'react'
import Textarea from 'rc-textarea'
import { RiSendPlane2Fill } from '@remixicon/react'
import { useTextAreaHeight } from './hooks'
import Button from '@/app/components/base/button'
import { FileUploaderInChatInput } from '@/app/components/base/file-uploader'
import cn from '@/utils/classnames'

const ChatInputArea = () => {
  const {
    textareaRef,
    handleTextareaResize,
    isMultipleLine,
  } = useTextAreaHeight()

  return (
    <div
      className={cn(
        'p-[9px] bg-components-panel-bg-blur border border-components-chat-input-border rounded-xl shadow-md',
        'max-h-[210px] overflow-y-auto',
        !isMultipleLine && 'flex items-center',
      )}
    >
      <Textarea
        ref={textareaRef}
        className='grow w-full p-1 leading-6 body-lg-regular text-text-tertiary'
        placeholder='Enter message...'
        autoSize
        onResize={handleTextareaResize}
      />
      <div className={cn(
        'shrink-0 flex items-center justify-end ml-1',
        isMultipleLine && 'sticky bottom-0',
      )}>
        <div className='flex items-center'>
          <FileUploaderInChatInput />
        </div>
        <Button
          className='ml-3 px-0 w-8'
          variant='primary'
        >
          <RiSendPlane2Fill className='w-4 h-4' />
        </Button>
      </div>
    </div>
  )
}

export default memo(ChatInputArea)
