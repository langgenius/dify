import type { FileUpload } from '@/app/components/base/features/types'
import {
  RiAttachmentLine,
} from '@remixicon/react'
import {
  memo,
  useCallback,
} from 'react'
import ActionButton from '@/app/components/base/action-button'
import { TransferMethod } from '@/types/app'
import { cn } from '@/utils/classnames'
import FileFromLinkOrLocal from '../file-from-link-or-local'

type FileUploaderInChatInputProps = {
  fileConfig: FileUpload
  readonly?: boolean
}
const FileUploaderInChatInput = ({
  fileConfig,
  readonly,
}: FileUploaderInChatInputProps) => {
  const renderTrigger = useCallback((open: boolean) => {
    return (
      <ActionButton
        size="l"
        className={cn(open && 'bg-state-base-hover')}
        disabled={readonly}
      >
        <RiAttachmentLine className="h-5 w-5" />
      </ActionButton>
    )
  }, [])

  if (readonly)
    return renderTrigger(false)

  return (
    <FileFromLinkOrLocal
      trigger={renderTrigger}
      fileConfig={fileConfig}
      showFromLocal={fileConfig?.allowed_file_upload_methods?.includes(TransferMethod.local_file)}
      showFromLink={fileConfig?.allowed_file_upload_methods?.includes(TransferMethod.remote_url)}
    />
  )
}

export default memo(FileUploaderInChatInput)
