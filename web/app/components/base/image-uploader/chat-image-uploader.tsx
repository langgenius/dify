import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Uploader from './uploader'
import ImageLinkInput from './image-link-input'
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
}
const UploadOnlyFromLocal: FC<UploadOnlyFromLocalProps> = ({
  onUpload,
}) => {
  return (
    <Uploader onUpload={onUpload}>
      {
        hovering => (
          <div className={`
            relative flex items-center justify-center w-8 h-8 rounded-lg cursor-pointer
            ${hovering && 'bg-gray-100'}
          `}>
            <ImagePlus className='w-4 h-4 text-gray-500' />
          </div>
        )
      }
    </Uploader>
  )
}

type UploaderButtonProps = {
  methods: VisionSettings['transfer_methods']
  onUpload: (imageFile: ImageFile) => void
}
const UploaderButton: FC<UploaderButtonProps> = ({
  methods,
  onUpload,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const hasUploadFromLocal = methods.find(method => method === TransferMethod.upload_file)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='top-start'
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <div className='relative flex items-center justify-center w-8 h-8 hover:bg-gray-100 rounded-lg cursor-pointer'>
          <ImagePlus className='w-4 h-4 text-gray-500' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-50'>
        <div className='p-2 w-[260px] bg-white rounded-lg border-[0.5px] border-gray-200 shadow-lg'>
          <ImageLinkInput onUpload={onUpload} />
          {
            hasUploadFromLocal && (
              <>
                <div className='flex items-center mt-2 px-2 text-xs font-medium text-gray-400'>
                  <div className='mr-3 w-[93px] h-[1px] bg-gradient-to-l from-[#F3F4F6]' />
                  OR
                  <div className='ml-3 w-[93px] h-[1px] bg-gradient-to-r from-[#F3F4F6]' />
                </div>
                <Uploader onUpload={onUpload}>
                  {
                    hovering => (
                      <div className={`
                        flex items-center justify-center h-8 text-[13px] font-medium text-[#155EEF] rounded-lg cursor-pointer
                        ${hovering && 'bg-primary-50'}
                      `}>
                        <Upload03 className='mr-1 w-4 h-4' />
                        {t('common.imageUploader.uploadFromComputer')}
                      </div>
                    )
                  }
                </Uploader>
              </>
            )
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

type ChatImageUploaderProps = {
  settings: VisionSettings
  onUpload: (imageFile: ImageFile) => void
}
const ChatImageUploader: FC<ChatImageUploaderProps> = ({
  settings,
  onUpload,
}) => {
  const onlyUploadLocal = settings.transfer_methods.length === 1 && settings.transfer_methods[0] === TransferMethod.upload_file

  if (onlyUploadLocal) {
    return (
      <UploadOnlyFromLocal onUpload={onUpload} />
    )
  }

  return (
    <UploaderButton
      methods={settings.transfer_methods}
      onUpload={onUpload}
    />
  )
}

export default ChatImageUploader
