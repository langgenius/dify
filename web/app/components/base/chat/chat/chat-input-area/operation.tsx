import { forwardRef } from 'react'
import { RiSendPlane2Fill } from '@remixicon/react'
import Button from '@/app/components/base/button'
import { FileUploaderInChatInput } from '@/app/components/base/file-uploader'
import cn from '@/utils/classnames'

const Operation = forwardRef<HTMLDivElement>((_, ref) => {
  return (
    <div
      className={cn(
        'shrink-0 flex items-center justify-end',
      )}
    >
      <div
        className='flex items-center pl-1'
        ref={ref}
      >
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
})
Operation.displayName = 'Operation'

export default Operation
