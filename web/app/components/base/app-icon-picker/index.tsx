import type { Area } from 'react-easy-crop'
import type { OnImageInput } from './ImageInput'
import type { AppIconType, ImageFile } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { Separator } from '@langgenius/dify-ui/separator'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DISABLE_UPLOAD_IMAGE_AS_ICON } from '@/config'
import { resolveEmoji } from '@/utils/emoji'
import {
  defaultEmojiBackground,
  getRandomEmoji,
  getRandomEmojiBackground,
} from '../emoji-picker/constants'
import EmojiPickerInner from '../emoji-picker/Inner'
import { addRecentEmoji, useRecentEmojis } from '../emoji-picker/storage'
import { useLocalFileUploader } from '../image-uploader/hooks'
import ImageInput from './ImageInput'
import getCroppedImg from './utils'

export type AppIconEmojiSelection = {
  type: 'emoji'
  icon: string
  background: string
}

export type AppIconImageSelection = {
  type: 'image'
  fileId: string
  url: string
}

export type AppIconSelection = AppIconEmojiSelection | AppIconImageSelection

type AppIconPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect?: (payload: AppIconSelection) => void
  enableImageUpload?: boolean
  initialEmoji?: {
    icon: string
    background?: string | null
  }
  className?: string
}

function AppIconPicker({
  open,
  onOpenChange,
  onSelect,
  enableImageUpload = true,
  initialEmoji,
  className,
}: AppIconPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <AppIconPickerContent
          key={`${initialEmoji?.icon ?? ''}:${initialEmoji?.background ?? ''}`}
          initialEmoji={initialEmoji}
          enableImageUpload={enableImageUpload}
          className={className}
          onOpenChange={onOpenChange}
          onSelect={onSelect}
        />
      ) : null}
    </Dialog>
  )
}

type AppIconPickerContentProps = {
  className?: string
  initialEmoji?: {
    icon: string
    background?: string | null
  }
  enableImageUpload: boolean
  onOpenChange: (open: boolean) => void
  onSelect?: (payload: AppIconSelection) => void
}

function AppIconPickerContent({
  className,
  initialEmoji,
  enableImageUpload,
  onOpenChange,
  onSelect,
}: AppIconPickerContentProps) {
  const { t } = useTranslation()

  const tabs = [
    {
      key: 'emoji',
      label: t(($) => $['iconPicker.emoji'], { ns: 'app' }),
      icon: <span className="text-base">🤖</span>,
    },
    {
      key: 'image',
      label: t(($) => $['iconPicker.image'], { ns: 'app' }),
      icon: <span className="i-ri-image-circle-ai-line size-4" />,
    },
  ]
  const [activeTab, setActiveTab] = useState<AppIconType>('emoji')
  const showImageUpload = enableImageUpload && !DISABLE_UPLOAD_IMAGE_AS_ICON

  const [emoji, setEmoji] = useState<{ emoji: string; background: string } | undefined>(() => {
    if (!initialEmoji?.icon) return undefined

    return {
      emoji: resolveEmoji(initialEmoji.icon),
      background: initialEmoji.background ?? defaultEmojiBackground,
    }
  })

  const [, setRecentEmojis] = useRecentEmojis()

  const [uploading, setUploading] = useState<boolean>()

  const { handleLocalFileUpload } = useLocalFileUploader({
    limit: 3,
    disabled: false,
    onUpload: (imageFile: ImageFile) => {
      if (imageFile.fileId) {
        setUploading(false)
        onSelect?.({
          type: 'image',
          fileId: imageFile.fileId,
          url: imageFile.url,
        })
        onOpenChange(false)
      }
    },
  })

  type InputImageInfo =
    | { file: File }
    | { tempUrl: string; croppedAreaPixels: Area; fileName: string }
  const [inputImageInfo, setInputImageInfo] = useState<InputImageInfo>()

  const handleImageInput: OnImageInput = async (
    isCropped: boolean,
    fileOrTempUrl: string | File,
    croppedAreaPixels?: Area,
    fileName?: string,
  ) => {
    setInputImageInfo(
      isCropped
        ? {
            tempUrl: fileOrTempUrl as string,
            croppedAreaPixels: croppedAreaPixels!,
            fileName: fileName!,
          }
        : { file: fileOrTempUrl as File },
    )
  }

  const handleSelect = async () => {
    if (activeTab === 'emoji') {
      if (emoji) {
        setRecentEmojis((recent) => addRecentEmoji(recent, emoji.emoji))
        onSelect?.({
          type: 'emoji',
          icon: emoji.emoji,
          background: emoji.background,
        })
        onOpenChange(false)
      }
    } else {
      if (!inputImageInfo) return
      setUploading(true)
      if ('file' in inputImageInfo) {
        handleLocalFileUpload(inputImageInfo.file)
        return
      }
      const blob = await getCroppedImg(
        inputImageInfo.tempUrl,
        inputImageInfo.croppedAreaPixels,
        inputImageInfo.fileName,
      )
      const file = new File([blob], inputImageInfo.fileName, { type: blob.type })
      handleLocalFileUpload(file)
    }
  }

  return (
    <DialogContent
      backdropProps={{ forceRender: true }}
      className={cn(
        'flex max-h-[calc(100dvh-2rem)] w-80.5 flex-col overflow-hidden p-0 text-left',
        activeTab === 'emoji' && 'h-[min(480px,calc(100dvh-2rem))]',
        className,
      )}
    >
      <DialogTitle className="sr-only">
        {t(($) => $['iconPicker.emoji'], { ns: 'app' })}
      </DialogTitle>

      {showImageUpload && (
        <div
          className={cn(
            'w-full shrink-0 px-3 pt-3 pb-2',
            activeTab === 'image' && 'border-b border-divider-subtle',
          )}
        >
          <SegmentedControl
            className="flex w-full"
            aria-label={t(($) => $['iconPicker.emoji'], { ns: 'app' })}
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(value)
              setInputImageInfo(undefined)
            }}
          >
            {tabs.map((tab) => (
              <SegmentedControlItem key={tab.key} value={tab.key} className="flex-1">
                <span className="flex size-5 items-center justify-center" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className="p-0.5">{tab.label}</span>
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
      )}

      {activeTab === 'emoji' && (
        <EmojiPickerInner
          className={cn('flex-1 overflow-hidden', !showImageUpload && 'pt-3')}
          emoji={emoji?.emoji}
          background={emoji?.background}
          onSelect={(emoji, background) => setEmoji({ emoji, background })}
        />
      )}
      {activeTab === 'image' && (
        <ImageInput className="min-h-0 overflow-y-auto" onImageInput={handleImageInput} />
      )}

      {(activeTab === 'emoji' || inputImageInfo) && (
        <>
          <Separator decorative className="m-0 h-[0.5px]" />
          <div className="flex w-full shrink-0 items-center justify-center gap-2 bg-components-panel-bg-blur p-3 backdrop-blur-sm">
            {activeTab === 'emoji' ? (
              <Button
                className="min-w-0 flex-1"
                onClick={() =>
                  setEmoji({
                    emoji: getRandomEmoji(emoji?.emoji),
                    background: getRandomEmojiBackground(emoji?.background),
                  })
                }
              >
                <span className="i-ri-dice-line size-4" aria-hidden="true" />
                {t(($) => $['iconPicker.tryYourLuck'], { ns: 'app' })}
              </Button>
            ) : (
              <Button className="min-w-0 flex-1" onClick={() => onOpenChange(false)}>
                {t(($) => $['iconPicker.cancel'], { ns: 'app' })}
              </Button>
            )}

            <Button
              variant="primary"
              className="min-w-0 flex-1"
              disabled={activeTab === 'emoji' ? !emoji : !inputImageInfo}
              loading={uploading}
              onClick={handleSelect}
            >
              {t(($) => $['iconPicker.ok'], { ns: 'app' })}
            </Button>
          </div>
        </>
      )}
    </DialogContent>
  )
}

export default AppIconPicker
