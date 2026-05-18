'use client'

import type { AvatarProps } from '@langgenius/dify-ui/avatar'
import type { Area } from 'react-easy-crop'
import type { OnImageInput } from '@/app/components/base/app-icon-picker/ImageInput'
import type { ImageFile } from '@/types/app'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ImageInput from '@/app/components/base/app-icon-picker/ImageInput'
import getCroppedImg from '@/app/components/base/app-icon-picker/utils'
import Divider from '@/app/components/base/divider'
import { useLocalFileUploader } from '@/app/components/base/image-uploader/hooks'
import { DISABLE_UPLOAD_IMAGE_AS_ICON } from '@/config'
import { updateUserProfile } from '@/service/common'

type InputImageInfo = { file: File } | { tempUrl: string, croppedAreaPixels: Area, fileName: string }
type AvatarWithEditProps = AvatarProps & { onSave?: () => void }

const AvatarWithEdit = ({ onSave, ...props }: AvatarWithEditProps) => {
  const { t } = useTranslation()

  const [inputImageInfo, setInputImageInfo] = useState<InputImageInfo>()
  const [isShowAvatarPicker, setIsShowAvatarPicker] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isShowDeleteConfirm, setIsShowDeleteConfirm] = useState(false)

  const [onAvatarError, setOnAvatarError] = useState(false)
  const canDeleteAvatar = !!props.avatar && !onAvatarError

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
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
    }
    catch (e) {
      toast.error((e as Error).message)
    }
  }, [onSave, t])

  const handleDeleteAvatar = useCallback(async () => {
    try {
      await updateUserProfile({ url: 'account/avatar', body: { avatar: '' } })
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
      setIsShowDeleteConfirm(false)
      onSave?.()
    }
    catch (e) {
      toast.error((e as Error).message)
    }
  }, [onSave, t])

  const handleDeleteAvatarClick = useCallback(() => {
    setIsShowAvatarPicker(false)
    setIsShowDeleteConfirm(true)
  }, [])

  const { handleLocalFileUpload } = useLocalFileUploader({
    limit: 3,
    disabled: false,
    onUpload: (imageFile: ImageFile) => {
      if (imageFile.progress === 100 && imageFile.fileId) {
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
        <button
          type="button"
          aria-label={t('avatar.editAction', { ns: 'common' })}
          className="group relative inline-flex overflow-hidden rounded-full border-none bg-transparent p-0 outline-hidden hover:opacity-90 focus-visible:ring-2 focus-visible:ring-components-input-border-hover active:opacity-80"
          onClick={() => setIsShowAvatarPicker(true)}
        >
          <Avatar {...props} onLoadingStatusChange={status => setOnAvatarError(status === 'error')} />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 motion-safe:transition-opacity">
            <span aria-hidden="true" className="i-ri-pencil-line size-5" />
          </span>
        </button>
      </div>

      <Dialog open={isShowAvatarPicker} onOpenChange={open => !open && setIsShowAvatarPicker(false)}>
        <DialogContent className="w-[362px]! p-0!">
          <ImageInput onImageInput={handleImageInput} cropShape="round" />
          <Divider className="m-0" />

          <div className="flex w-full items-center justify-center gap-2 p-3">
            {canDeleteAvatar && (
              <Button tone="destructive" className="shrink-0" onClick={handleDeleteAvatarClick}>
                {t('operation.delete', { ns: 'common' })}
              </Button>
            )}
            <Button className="min-w-0 flex-1" onClick={() => setIsShowAvatarPicker(false)}>
              {t('iconPicker.cancel', { ns: 'app' })}
            </Button>

            <Button variant="primary" className="min-w-0 flex-1" disabled={uploading || !inputImageInfo} loading={uploading} onClick={handleSelect}>
              {t('iconPicker.ok', { ns: 'app' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isShowDeleteConfirm} onOpenChange={open => !open && setIsShowDeleteConfirm(false)}>
        <DialogContent className="w-[362px]! p-6!">
          <div className="mb-3 title-2xl-semi-bold text-text-primary">{t('avatar.deleteTitle', { ns: 'common' })}</div>
          <p className="mb-8 text-text-secondary">{t('avatar.deleteDescription', { ns: 'common' })}</p>

          <div className="flex w-full items-center justify-center gap-2">
            <Button className="w-full" onClick={() => setIsShowDeleteConfirm(false)}>
              {t('operation.cancel', { ns: 'common' })}
            </Button>

            <Button variant="primary" tone="destructive" className="w-full" onClick={handleDeleteAvatar}>
              {t('operation.delete', { ns: 'common' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default AvatarWithEdit
