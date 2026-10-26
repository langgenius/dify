'use client'

import type { AvatarProps } from '@langgenius/dify-ui/avatar'
import type { ImageIconInputValue } from '@/app/components/base/icon-picker/image-input'
import type { ImageFile } from '@/types/app'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Separator } from '@langgenius/dify-ui/separator'
import { useMutation } from '@tanstack/react-query'
import * as React from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageIconInput } from '@/app/components/base/icon-picker/image-input'
import { useLocalFileUploader } from '@/app/components/base/image-uploader/hooks'
import { toast } from '@/app/notifications'
import { DISABLE_UPLOAD_IMAGE_AS_ICON } from '@/config'
import { consoleQuery } from '@/service/console'
import { getAvatarInitial } from '@/utils/avatar'
import { createAvatarImageFile, createCroppedAvatarImage } from './avatar-image'

type AvatarWithEditProps = {
  avatar: string | null
  name: string
  size?: AvatarProps['size']
}

const AvatarWithEdit = ({ avatar, name, size }: AvatarWithEditProps) => {
  const { t } = useTranslation(['app', 'common'])
  const { mutateAsync: updateProfile } = useMutation(
    consoleQuery.account.profile.patch.mutationOptions(),
  )

  const [inputImageInfo, setInputImageInfo] = useState<ImageIconInputValue | null>(null)
  const [isShowAvatarPicker, setIsShowAvatarPicker] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isShowDeleteConfirm, setIsShowDeleteConfirm] = useState(false)

  const canDeleteAvatar = !!avatar

  const handleSaveAvatar = useCallback(
    async (uploadedFileId: string) => {
      try {
        await updateProfile({ body: { avatar: uploadedFileId } })
        setIsShowAvatarPicker(false)
      } catch (e) {
        toast.error((e as Error).message)
      }
    },
    [updateProfile],
  )

  const handleDeleteAvatar = useCallback(async () => {
    try {
      await updateProfile({ body: { avatar: '' } })
      setIsShowDeleteConfirm(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [updateProfile])

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
        setInputImageInfo(null)
        handleSaveAvatar(imageFile.fileId)
      }

      // Error
      if (imageFile.progress === -1) setUploading(false)
    },
  })

  const handleSelect = useCallback(async () => {
    if (!inputImageInfo) return
    setUploading(true)
    if ('file' in inputImageInfo) {
      handleLocalFileUpload(inputImageInfo.file)
      return
    }
    const blob = await createCroppedAvatarImage(
      inputImageInfo.url,
      inputImageInfo.area,
      inputImageInfo.fileName,
    )
    const file = createAvatarImageFile(blob, inputImageInfo.fileName)
    handleLocalFileUpload(file)
  }, [handleLocalFileUpload, inputImageInfo])

  if (DISABLE_UPLOAD_IMAGE_AS_ICON) {
    return (
      <Avatar size={size} aria-hidden="true">
        <AvatarFallback>{getAvatarInitial(name)}</AvatarFallback>
        <AvatarImage src={avatar || undefined} alt="" />
      </Avatar>
    )
  }

  return (
    <>
      <div>
        <button
          type="button"
          aria-label={t(($) => $['avatar.editAction'], { ns: 'common' })}
          className="group relative inline-flex overflow-hidden rounded-full border-none bg-transparent p-0 outline-hidden hover:opacity-90 focus-visible:ring-2 focus-visible:ring-components-input-border-hover active:opacity-80"
          onClick={() => {
            setInputImageInfo(null)
            setIsShowAvatarPicker(true)
          }}
        >
          <Avatar size={size} aria-hidden="true">
            <AvatarFallback>{getAvatarInitial(name)}</AvatarFallback>
            <AvatarImage src={avatar || undefined} alt="" />
          </Avatar>
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 motion-safe:transition-opacity">
            <span aria-hidden="true" className="i-ri-pencil-line size-5" />
          </span>
        </button>
      </div>

      <Dialog
        open={isShowAvatarPicker}
        onOpenChange={(open) => !open && setIsShowAvatarPicker(false)}
      >
        <DialogContent className="w-90.5">
          <DialogTitle className="sr-only">
            {t(($) => $['avatar.editAction'], { ns: 'common' })}
          </DialogTitle>
          <ImageIconInput onChange={setInputImageInfo} cropShape="round" />
          <Separator decorative className="m-0 h-[0.5px]" />

          <div className="flex w-full items-center justify-center gap-2 p-3">
            {canDeleteAvatar && (
              <Button tone="destructive" className="shrink-0" onClick={handleDeleteAvatarClick}>
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </Button>
            )}
            <Button className="min-w-0 flex-1" onClick={() => setIsShowAvatarPicker(false)}>
              {t(($) => $['iconPicker.cancel'], { ns: 'app' })}
            </Button>

            <Button
              variant="primary"
              className="min-w-0 flex-1"
              disabled={!inputImageInfo}
              loading={uploading}
              onClick={handleSelect}
            >
              {t(($) => $['iconPicker.ok'], { ns: 'app' })}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isShowDeleteConfirm}
        onOpenChange={(open) => !open && setIsShowDeleteConfirm(false)}
      >
        <DialogContent className="w-90.5">
          <DialogHeader>
            <DialogTitle>{t(($) => $['avatar.deleteTitle'], { ns: 'common' })}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-text-secondary">
              {t(($) => $['avatar.deleteDescription'], { ns: 'common' })}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button className="w-full" onClick={() => setIsShowDeleteConfirm(false)}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </Button>

            <Button
              variant="primary"
              tone="destructive"
              className="w-full"
              onClick={handleDeleteAvatar}
            >
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default AvatarWithEdit
