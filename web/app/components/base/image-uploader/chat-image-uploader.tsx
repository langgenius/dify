import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from './uploader'
import ImageLinkInput from './image-link-input'
import cn from '@/utils/classnames'
import { ImagePlus } from '@/app/components/base/icons/src/vender/line/images'
import { TransferMethod } from '@/types/app'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { Upload03 } from '@/app/components/base/icons/src/vender/line/general'
import type { ImageFile, VisionSettings } from '@/types/app'

type UploadOnlyFromLocalProps = {
  onUpload: (imageFile: ImageFile) => void
  disabled?: boolean
  limit?: number
}
const UploadOnlyFromLocal: FC<UploadOnlyFromLocalProps> = ({
  onUpload,
  disabled,
  limit,
}) => {
  return (
    <Uploader onUpload={onUpload} disabled={disabled} limit={limit}>
      {hovering => (
        <div
          className={`
            relative flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg
            ${hovering && 'bg-gray-100'}
          `}
        >
          <ImagePlus className="h-4 w-4 text-gray-500" />
        </div>
      )}
    </Uploader>
  )
}

type UploaderButtonProps = {
  methods: VisionSettings['transfer_methods']
  onUpload: (imageFile: ImageFile) => void
  disabled?: boolean
  limit?: number
}
const UploaderButton: FC<UploaderButtonProps> = ({
  methods,
  onUpload,
  disabled,
  limit,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const hasUploadFromLocal = methods.find(
    method => method === TransferMethod.local_file,
  )

  const handleUpload = (imageFile: ImageFile) => {
    onUpload(imageFile)
  }

  const closePopover = () => setOpen(false)

  const handleToggle = () => {
    if (disabled)
      return

    setOpen(v => !v)
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement="top-start"
    >
      <PortalToFollowElemTrigger onClick={handleToggle}>
        <button
          type="button"
          disabled={disabled}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg enabled:hover:bg-gray-100 disabled:cursor-not-allowed"
        >
          <ImagePlus className="h-4 w-4 text-gray-500" />
        </button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-50">
        <div className="w-[260px] rounded-lg border-[0.5px] border-gray-200 bg-white p-2 shadow-lg">
          <ImageLinkInput onUpload={handleUpload} disabled={disabled} />
          {hasUploadFromLocal && (
            <>
              <div className="mt-2 flex items-center px-2 text-xs font-medium text-gray-400">
                <div className="mr-3 h-px w-[93px] bg-gradient-to-l from-[#F3F4F6]" />
                OR
                <div className="ml-3 h-px w-[93px] bg-gradient-to-r from-[#F3F4F6]" />
              </div>
              <Uploader
                onUpload={handleUpload}
                limit={limit}
                closePopover={closePopover}
              >
                {hovering => (
                  <div
                    className={cn(
                      'flex h-8 cursor-pointer items-center justify-center rounded-lg text-[13px] font-medium text-[#155EEF]',
                      hovering && 'bg-primary-50',
                    )}
                  >
                    <Upload03 className="mr-1 h-4 w-4" />
                    {t('common.imageUploader.uploadFromComputer')}
                  </div>
                )}
              </Uploader>
            </>
          )}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

type ChatImageUploaderProps = {
  settings: VisionSettings
  onUpload: (imageFile: ImageFile) => void
  disabled?: boolean
}
const ChatImageUploader: FC<ChatImageUploaderProps> = ({
  settings,
  onUpload,
  disabled,
}) => {
  const onlyUploadLocal
    = settings.transfer_methods.length === 1
    && settings.transfer_methods[0] === TransferMethod.local_file

  if (onlyUploadLocal) {
    return (
      <UploadOnlyFromLocal
        onUpload={onUpload}
        disabled={disabled}
        limit={+settings.image_file_size_limit!}
      />
    )
  }

  return (
    <UploaderButton
      methods={settings.transfer_methods}
      onUpload={onUpload}
      disabled={disabled}
      limit={+settings.image_file_size_limit!}
    />
  )
}

export default ChatImageUploader
