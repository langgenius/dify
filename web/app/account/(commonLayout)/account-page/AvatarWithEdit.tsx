'use client'

import type { Area } from 'react-easy-crop'
import React, { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { RiDeleteBin5Line, RiPencilLine } from '@remixicon/react'
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
import { DISABLE_UPLOAD_IMAGE_AS_ICON } from '@/config'

type InputImageInfo = { file: File } | { tempUrl: string; croppedAreaPixels: Area; fileName: string }
type AvatarWithEditProps = AvatarProps & { onSave?: () => void }

const AvatarWithEdit = ({ onSave, ...props }: AvatarWithEditProps) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const [inputImageInfo, setInputImageInfo] = useState<InputImageInfo>()
  const [isShowAvatarPicker, setIsShowAvatarPicker] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isShowDeleteConfirm, setIsShowDeleteConfirm] = useState(false)
  const [hoverArea, setHoverArea] = useState<string>('left')

  const [onAvatarError, setOnAvatarError] = useState(false)

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
      setIsShowAvatarPicker(false)
      onSave?.()
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
    }
    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
    }
  }, [notify, onSave, t])

  const handleDeleteAvatar = useCallback(async () => {
    try {
      await updateUserProfile({ url: 'account/avatar', body: { avatar: '' } })
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      setIsShowDeleteConfirm(false)
      onSave?.()
    }
    catch (e) {
      notify({ type: 'error', message: (e as Error).message })
    }
  }, [notify, onSave, t])

  const { handleLocalFileUpload } = useLocalFileUploader({
    limit: 3,
    disabled: false,
    onUpload: (imageFile: ImageFile) => {
      if (imageFile.progress === 100) {
        setUploading(false)
        setInputImageInfo(undefined)
        handleSaveAvatar(imageFile.fileId)
      }

      // Error
      if (imageFile.progress === -1)
        setUploading(false)
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

  if (DISABLE_UPLOAD_IMAGE_AS_ICON)
    return <Avatar {...props} />

  return (
    <>
      <div>
        <div className="group relative">
          <Avatar {...props} onError={(x: boolean) => setOnAvatarError(x)} />
          <div
            className="absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => {
              if (hoverArea === 'right' && !onAvatarError)
                setIsShowDeleteConfirm(true)
              else
                setIsShowAvatarPicker(true)
            }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const x = e.clientX - rect.left
              const isRight = x > rect.width / 2
              setHoverArea(isRight ? 'right' : 'left')
            }}
          >
            {hoverArea === 'right' && !onAvatarError ? (
              <span className="text-xs text-white">
                <RiDeleteBin5Line />
              </span>
            ) : (
              <span className="text-xs text-white">
                <RiPencilLine />
              </span>
            )}
          </div>
        </div>
      </div>

      <Modal
        closable
        className="!w-[362px] !p-0"
        isShow={isShowAvatarPicker}
        onClose={() => setIsShowAvatarPicker(false)}
      >
        <ImageInput onImageInput={handleImageInput} cropShape='round' />
        <Divider className='m-0' />

        <div className='flex w-full items-center justify-center gap-2 p-3'>
          <Button className='w-full' onClick={() => setIsShowAvatarPicker(false)}>
            {t('app.iconPicker.cancel')}
          </Button>

          <Button variant="primary" className='w-full' disabled={uploading || !inputImageInfo} loading={uploading} onClick={handleSelect}>
            {t('app.iconPicker.ok')}
          </Button>
        </div>
      </Modal>

      <Modal
        closable
        className="!w-[362px] !p-6"
        isShow={isShowDeleteConfirm}
        onClose={() => setIsShowDeleteConfirm(false)}
      >
        <div className="title-2xl-semi-bold mb-3 text-text-primary">{t('common.avatar.deleteTitle')}</div>
        <p className="mb-8 text-text-secondary">{t('common.avatar.deleteDescription')}</p>

        <div className="flex w-full items-center justify-center gap-2">
          <Button className="w-full" onClick={() => setIsShowDeleteConfirm(false)}>
            {t('common.operation.cancel')}
          </Button>

          <Button variant="warning" className="w-full" onClick={handleDeleteAvatar}>
            {t('common.operation.delete')}
          </Button>
        </div>
      </Modal>
    </>
  )
}

export default AvatarWithEdit
