'use client'

import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { ImageIconInputValue } from './image-input'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DISABLE_UPLOAD_IMAGE_AS_ICON } from '@/config'
import { resolveEmoji } from '@/utils/emoji'
import { useLocalFileUploader } from '../image-uploader/hooks'
import { EmojiIconEditor } from './emoji-icon-editor'
import { defaultEmojiBackground, getRandomEmoji, getRandomEmojiBackground } from './emoji-styles'
import getCroppedImg from './image-crop'
import { ImageIconInput } from './image-input'
import { addRecentEmoji, useRecentEmojis } from './recent-emojis'

export type EmojiIcon = {
  type: 'emoji'
  icon: string
  background: string
}

export type ImageIcon = {
  type: 'image'
  fileId: string
  url: string
}

export type IconPickerValue = EmojiIcon | ImageIcon

export type IconPickerDialogProps = Pick<DialogContentProps, 'initialFocus' | 'finalFocus'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Initial draft for each dialog session. */
  defaultValue?: IconPickerValue
  /** Receives the confirmed value after any image upload; does not await consumer persistence. */
  onConfirm: (value: IconPickerValue) => void
  enableImageUpload?: boolean
  className?: string
}

export function IconPickerDialog({
  open,
  onOpenChange,
  className,
  initialFocus,
  finalFocus,
  ...props
}: IconPickerDialogProps) {
  const { t } = useTranslation(['app'])
  const popupRef = useRef<HTMLDivElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popupRef}
        backdropProps={{ forceRender: true }}
        initialFocus={
          initialFocus ??
          ((interaction) =>
            interaction === 'touch'
              ? popupRef.current
              : (Array.from(
                  popupRef.current?.querySelectorAll<HTMLElement>(
                    '[data-icon-picker-initial-focus]',
                  ) ?? [],
                ).find((element) => !element.closest('[hidden], [data-hidden]')) ?? true))
        }
        finalFocus={finalFocus}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] w-80.5 flex-col overflow-hidden p-0 text-left',
          className,
        )}
      >
        <DialogTitle className="sr-only">
          {t(($) => $['iconPicker.title'], { ns: 'app' })}
        </DialogTitle>
        <IconPickerSession {...props} open={open} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  )
}

function IconPickerSession({
  open,
  defaultValue,
  onConfirm,
  onOpenChange,
  enableImageUpload = true,
}: Pick<
  IconPickerDialogProps,
  'open' | 'defaultValue' | 'onConfirm' | 'onOpenChange' | 'enableImageUpload'
>) {
  const { t } = useTranslation(['app', 'common'])
  const imageEnabled = enableImageUpload && !DISABLE_UPLOAD_IMAGE_AS_ICON
  const [activeTab, setActiveTab] = useState(
    defaultValue?.type === 'image' && imageEnabled ? 'image' : 'emoji',
  )
  const [emoji, setEmoji] = useState<EmojiIcon | undefined>(() =>
    defaultValue?.type === 'emoji'
      ? {
          ...defaultValue,
          icon: resolveEmoji(defaultValue.icon),
          background: defaultValue.background || defaultEmojiBackground,
        }
      : undefined,
  )
  const [image, setImage] = useState<ImageIcon | undefined>(() =>
    defaultValue?.type === 'image' ? defaultValue : undefined,
  )
  const [imageInput, setImageInput] = useState<ImageIconInputValue | null>(null)
  const [uploading, setUploading] = useState(false)
  const [, setRecentEmojis] = useRecentEmojis()
  const [uploadError, setUploadError] = useState(false)
  const activeRef = useRef(open)
  useLayoutEffect(() => {
    activeRef.current = open
    return () => {
      activeRef.current = false
    }
  }, [open])

  const { handleLocalFileUpload } = useLocalFileUploader({
    limit: 3,
    disabled: !imageEnabled,
    onUpload: (file) => {
      if (!activeRef.current) return
      if (file.progress === -1) setUploading(false)
      if (file.progress === 100 && file.fileId) {
        setUploading(false)
        onConfirm({ type: 'image', fileId: file.fileId, url: file.url })
        onOpenChange(false)
      }
    },
  })
  const confirm = async () => {
    if (activeTab === 'emoji') {
      if (!emoji) return
      setRecentEmojis((recent) => addRecentEmoji(recent, emoji.icon))
      onConfirm(emoji)
      onOpenChange(false)
    } else if (imageInput) {
      setUploadError(false)
      setUploading(true)
      try {
        let file: File
        if (imageInput.type === 'file') file = imageInput.file
        else {
          const blob = await getCroppedImg(imageInput.url, imageInput.area, imageInput.fileName)
          file = new File([blob], imageInput.fileName, { type: blob.type })
        }
        if (activeRef.current) handleLocalFileUpload(file)
      } catch {
        if (activeRef.current) {
          setUploading(false)
          setUploadError(true)
        }
      }
    } else if (image) {
      onConfirm(image)
      onOpenChange(false)
    }
  }

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => setActiveTab(String(value))}
      className={cn(
        'flex min-h-0 flex-col',
        activeTab === 'emoji'
          ? 'h-[min(479px,calc(100dvh-2rem-1px))]'
          : 'max-h-[calc(100dvh-2rem)]',
      )}
    >
      {imageEnabled && (
        <div
          className={cn(
            'shrink-0 px-3 pt-3 pb-2',
            activeTab === 'image' && 'border-b border-divider-subtle',
          )}
        >
          <TabsList
            aria-label={t(($) => $['iconPicker.title'], { ns: 'app' })}
            className="gap-px rounded-[10px] bg-components-segmented-control-bg-normal p-0.5"
          >
            {(['emoji', 'image'] as const).map((kind) => (
              <TabsTab
                key={kind}
                value={kind}
                disabled={uploading}
                className="flex h-7 flex-1 items-center justify-center gap-1 rounded-lg border-0 p-1 system-sm-medium data-active:bg-components-segmented-control-item-active-bg data-active:text-text-accent-light-mode-only data-active:shadow-xs"
              >
                <span
                  aria-hidden="true"
                  className={kind === 'image' ? 'i-ri-image-circle-ai-line size-4' : 'text-base'}
                >
                  {kind === 'emoji' ? '🤖' : null}
                </span>
                {t(($) => $[kind === 'emoji' ? 'iconPicker.emoji' : 'iconPicker.image'], {
                  ns: 'app',
                })}
              </TabsTab>
            ))}
          </TabsList>
        </div>
      )}
      {imageEnabled ? (
        <TabsPanel
          keepMounted
          value="emoji"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col data-hidden:hidden"
        >
          <EmojiIconEditor value={emoji} onValueChange={setEmoji} />
        </TabsPanel>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-3">
          <EmojiIconEditor value={emoji} onValueChange={setEmoji} />
        </div>
      )}
      {imageEnabled && (
        <TabsPanel
          keepMounted
          value="image"
          tabIndex={-1}
          className="min-h-0 overflow-y-auto data-hidden:hidden"
        >
          {image ? (
            <div className="flex h-52 flex-col items-center justify-center gap-3 p-3">
              <img
                src={image.url}
                alt={t(($) => $['iconPicker.image'], { ns: 'app' })}
                className="size-16 rounded-2xl object-contain"
              />
              <Button data-icon-picker-initial-focus onClick={() => setImage(undefined)}>
                {t(($) => $['operation.change'], { ns: 'common' })}
              </Button>
            </div>
          ) : (
            <ImageIconInput onChange={setImageInput} />
          )}
        </TabsPanel>
      )}
      {uploadError && (
        <p role="alert" className="px-3 text-text-destructive">
          {t(($) => $['imageUploader.uploadFromComputerReadError'], { ns: 'common' })}
        </p>
      )}
      {(activeTab === 'emoji' || imageInput || image) && (
        <div className="flex shrink-0 gap-2 border-t border-divider-subtle bg-components-panel-bg-blur p-3 backdrop-blur-sm">
          {activeTab === 'emoji' ? (
            <Button
              className="min-w-0 flex-1"
              onClick={() =>
                setEmoji({
                  type: 'emoji',
                  icon: getRandomEmoji(emoji?.icon),
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
            disabled={activeTab === 'emoji' ? !emoji : !imageInput && !image}
            loading={uploading}
            onClick={() => void confirm()}
          >
            {t(($) => $['iconPicker.ok'], { ns: 'app' })}
          </Button>
        </div>
      )}
    </Tabs>
  )
}
