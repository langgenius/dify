import {
  memo,
  useCallback,
} from 'react'
import {
  RiAttachmentLine,
} from '@remixicon/react'
import FileFromLinkOrLocal from '../file-from-link-or-local'
import ActionButton from '@/app/components/base/action-button'
import cn from '@/utils/classnames'

const FileUploaderInChatInput = () => {
  const renderTrigger = useCallback((open: boolean) => {
    return (
      <ActionButton
        size='l'
        className={cn(open && 'bg-state-base-hover')}
      >
        <RiAttachmentLine className='w-5 h-5' />
      </ActionButton>
    )
  }, [])

  return (
    <FileFromLinkOrLocal
      trigger={renderTrigger}
    />
  )
}

export default memo(FileUploaderInChatInput)
