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
import type { FileUpload } from '@/app/components/base/features/types'

type FileUploaderInChatInputProps = {
  fileConfig: FileUpload
}
const FileUploaderInChatInput = ({
  fileConfig,
}: FileUploaderInChatInputProps) => {
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
      fileConfig={fileConfig}
    />
  )
}

export default memo(FileUploaderInChatInput)
