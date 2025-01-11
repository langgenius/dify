'use client'

import type { Area } from 'react-easy-crop'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { updateUserProfile } from '@/service/common'
import { ToastContext } from '@/app/components/base/toast'
import ImageInput, { type OnImageInput } from '@/app/components/base/app-icon-picker/ImageInput'
import Modal from '@/app/components/base/modal'
import Divider from '@/app/components/base/divider'
import Button from '@/app/components/base/button'
import Avatar, { type AvatarProps } from '@/app/components/base/avatar'
import { useLocalFileUploader } from '@/app/components/base/image-uploader/hooks'
import type { ImageFile } from '@/types/app'
import getCroppedImg from '@/app/components/base/app-icon-picker/utils'

type InputImageInfo = { file: File } | { tempUrl: string; croppedAreaPixels: Area; fileName: string }
type AvatarWithEditProps = AvatarProps & { onSelect?: () => void }

const AvatarWithEdit = ({ onSelect, ...props }: AvatarWithEditProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const [inputImageInfo, setInputImageInfo] = useState<InputImageInfo>()
  const [isShowAvatarIconPicker, setIsShowAvaterIconPicker] = useState(false)
  const [uploading, setUploading] = useState(false)

  const handleImageInput: OnImageInput = useCallback(async (isCropped: boolean, fileOrTempUrl: string | File, croppedAreaPixels?: Area, fileName?: string) => {
    setInputImageInfo(
      isCropped
        ? { tempUrl: fileOrTempUrl as string, croppedAreaPixels: croppedAreaPixels!, fileName: fileName! }
        : { file: fileOrTempUrl as File },
    )
  }, [setInputImageInfo])

  const handleSaveAvatar = useCallback(async (uploadedFileId: string) => {
    try {
      await updateUserProfile({ url: 'account/avatar', body: { avatar: uploadedFileId } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      setIsShowAvaterIconPicker(false)
      onSelect?.()
    }
    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
    }
  }, [notify, onSelect, t])

  const { handleLocalFileUpload } = useLocalFileUploader({
    limit: 3,
    disabled: false,
    onUpload: (imageFile: ImageFile) => {
      if (imageFile.fileId) {
        setUploading(false)
        handleSaveAvatar(imageFile.fileId)
      }
    },
  })

  const handleSelect = useCallback(async () => {
    if (!inputImageInfo)
      return
    setUploading(true)
    if ('file' in inputImageInfo) {
      handleLocalFileUpload(inputImageInfo.file)
      return
    }
    const blob = await getCroppedImg(inputImageInfo.tempUrl, inputImageInfo.croppedAreaPixels, inputImageInfo.fileName)
    const file = new File([blob], inputImageInfo.fileName, { type: blob.type })
    handleLocalFileUpload(file)
  }, [handleLocalFileUpload, inputImageInfo])

  return (
    <>
      <div>
        <div className="relative group">
          <Avatar {...props} />
          <div
            onClick={() => { setIsShowAvaterIconPicker(true) }}
            className="absolute inset-0 bg-black bg-opacity-50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center"
          >
            <span className="text-white text-xs">変更</span>
          </div>
        </div>
      </div>

      <Modal
        closable
        className="!w-[362px] !p-0"
        isShow={isShowAvatarIconPicker}
        onClose={() => setIsShowAvaterIconPicker(false)}
      >
        <ImageInput onImageInput={handleImageInput} cropShape='round' />
        <Divider className='m-0' />

        <div className='w-full flex items-center justify-center p-3 gap-2'>
          <Button className='w-full' onClick={() => setIsShowAvaterIconPicker(false)}>
            {t('app.iconPicker.cancel')}
          </Button>

          <Button variant="primary" className='w-full' disabled={uploading} loading={uploading} onClick={handleSelect}>
            {t('app.iconPicker.ok')}
          </Button>
        </div>
      </Modal>
    </>
  )
}

export default AvatarWithEdit
