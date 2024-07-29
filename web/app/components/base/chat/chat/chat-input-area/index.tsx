import {
  memo,
  useState,
} from 'react'
import Textarea from 'rc-textarea'
import { useTextAreaHeight } from './hooks'
import Operation from './operation'
import cn from '@/utils/classnames'
import { FileListFlexOperation } from '@/app/components/base/file-uploader'

const ChatInputArea = () => {
  const {
    wrapperRef,
    textareaRef,
    textValueRef,
    holdSpaceRef,
    handleTextareaResize,
    isMultipleLine,
  } = useTextAreaHeight()
  const [value, setValue] = useState('')

  const operation = <Operation ref={holdSpaceRef} />

  return (
    <div
      className={cn(
        'p-[9px] bg-components-panel-bg-blur border border-blue-300 rounded-xl shadow-md',
      )}
    >
      <div className='max-h-[158px] overflow-y-auto'>
        <FileListFlexOperation />
        <div
          ref={wrapperRef}
          className='flex items-center justify-between'
        >
          <div className='flex items-center relative grow w-full'>
            <div
              ref={textValueRef}
              className='absolute w-auto h-auto p-1 leading-6 body-lg-regular pointer-events-none whitespace-pre invisible'
            >
              {value}
            </div>
            <Textarea
              ref={textareaRef}
              className='p-1 w-full leading-6 body-lg-regular text-text-tertiary outline-none'
              placeholder='Enter message...'
              autoSize={{ minRows: 1 }}
              onResize={handleTextareaResize}
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                handleTextareaResize()
              }}
            />
          </div>
          {
            !isMultipleLine && operation
          }
        </div>
      </div>
      {
        isMultipleLine && operation
      }
    </div>
  )
}

export default memo(ChatInputArea)
