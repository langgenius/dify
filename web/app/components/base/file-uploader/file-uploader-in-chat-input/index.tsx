import type { FileUpload } from '@/app/components/base/features/types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { TransferMethod } from '@/types/app'
import FileFromLinkOrLocal from '../file-from-link-or-local'

type FileUploaderInChatInputProps = {
  fileConfig: FileUpload
  readonly?: boolean
}
const FileUploaderInChatInput = ({ fileConfig, readonly }: FileUploaderInChatInputProps) => {
  const { t } = useTranslation()
  const renderTrigger = useCallback(
    (_open: boolean) => {
      return (
        <button
          type="button"
          aria-label={t(($) => $['fileUploader.uploadFromComputer'], { ns: 'common' })}
          className={cn(
            'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg p-1.5 text-text-tertiary outline-hidden',
            'hover:bg-state-base-hover hover:text-text-secondary',
            'focus-visible:inset-ring-2 focus-visible:inset-ring-state-accent-solid',
            'data-popup-open:bg-state-base-hover',
            'disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent disabled:hover:text-text-disabled',
          )}
          disabled={readonly}
        >
          <span className="i-ri-attachment-line size-5" aria-hidden="true" />
        </button>
      )
    },
    [readonly, t],
  )

  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center">
      {readonly ? (
        renderTrigger(false)
      ) : (
        <FileFromLinkOrLocal
          trigger={renderTrigger}
          fileConfig={fileConfig}
          showFromLocal={fileConfig?.allowed_file_upload_methods?.includes(
            TransferMethod.local_file,
          )}
          showFromLink={fileConfig?.allowed_file_upload_methods?.includes(
            TransferMethod.remote_url,
          )}
        />
      )}
    </span>
  )
}

export default memo(FileUploaderInChatInput)
